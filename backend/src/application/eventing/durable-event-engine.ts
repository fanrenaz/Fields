import { ApplicationError } from "../platform/errors.js";
import type { Clock, EventCodecRegistry } from "../platform/ports/index.js";

import {
  EVENT_CODEC_INVALID_FAILURE_CODE,
  EVENT_CODEC_UNAVAILABLE_FAILURE_CODE,
  EVENT_HANDLER_UNAVAILABLE_FAILURE_CODE,
  toEventDeliveryFailure,
} from "./failure-policy.js";
import type {
  ClaimedDelivery,
  EventClaimRenewalLease,
  EventClaimRenewalScheduler,
  EventConsumerName,
  EventDeadLetterTransaction,
  EventConsumerRegistry,
  EventDeliveryFailure,
  EventDeliveryRepository,
  EventHealthRepository,
  EventHandler,
  EventInboxRepository,
  OutboxDispatchRepository,
  PersistedEvent,
} from "./ports/index.js";
import { isDeadLetterAttempt, retryDelayMs } from "./retry-policy.js";
import { isRetentionSweepDue, retentionBeforeMs } from "./retention-policy.js";

export const EVENT_DEFAULT_FAN_OUT_LIMIT = 100;
export const EVENT_DEFAULT_DELIVERY_LIMIT = 100;
export const EVENT_DEFAULT_CLAIM_TTL_MS = 30_000;
export const EVENT_DEFAULT_CLAIM_RENEWAL_INTERVAL_MS = 10_000;

export type DurableEventEngineDependencies = {
  workerId: string;
  clock: Clock;
  codecs: EventCodecRegistry;
  consumers: EventConsumerRegistry;
  handlers: readonly EventHandler[];
  outbox: OutboxDispatchRepository;
  deliveries: EventDeliveryRepository;
  inbox: EventInboxRepository;
  health: EventHealthRepository;
  claimRenewal?: EventClaimRenewalScheduler;
  fanOutLimit?: number;
  deliveryLimit?: number;
  claimTtlMs?: number;
  claimRenewalIntervalMs?: number;
};

export type EventDeliveryTickResult = {
  claimed: number;
  succeeded: number;
  alreadyProcessed: number;
  retried: number;
  deadLettered: number;
};

export type EventRetentionSweepResult = {
  ran: boolean;
  deleted: number;
};

export type EventTickResult = {
  fannedOut: number;
  deliveries: EventDeliveryTickResult;
  retention: EventRetentionSweepResult;
};

export type EventWorkerHealth = {
  workerId: string;
  running: boolean;
  consecutiveFailures: number;
  lastSuccessfulTickAtMs: number;
  pendingCount: number;
  deadLetterCount: number;
};

type DeliveryOutcome = "succeeded" | "already_processed" | "retried" | "dead_lettered";

/**
 * Framework-free orchestration for the durable two-stage Event process.
 * Persistence adapters own locking and transactions; this class owns the
 * deterministic registry, retry policy, safe failure projection, and attempt
 * lifecycle.
 */
export class DurableEventEngine {
  readonly #workerId: string;
  readonly #clock: Clock;
  readonly #codecs: EventCodecRegistry;
  readonly #consumers: EventConsumerRegistry;
  readonly #handlersByName: ReadonlyMap<EventConsumerName, EventHandler>;
  readonly #activeConsumers: readonly EventConsumerName[];
  readonly #outbox: OutboxDispatchRepository;
  readonly #deliveries: EventDeliveryRepository;
  readonly #inbox: EventInboxRepository;
  readonly #health: EventHealthRepository;
  readonly #claimRenewal: EventClaimRenewalScheduler | undefined;
  readonly #fanOutLimit: number;
  readonly #deliveryLimit: number;
  readonly #claimTtlMs: number;
  readonly #claimRenewalIntervalMs: number;
  #lastSuccessfulRetentionSweepAtMs: number | null = null;
  #running = false;
  #consecutiveFailures = 0;
  #lastSuccessfulTickAtMs = 0;

  constructor(dependencies: DurableEventEngineDependencies) {
    assertPositiveInteger("fanOutLimit", dependencies.fanOutLimit ?? EVENT_DEFAULT_FAN_OUT_LIMIT);
    assertPositiveInteger("deliveryLimit", dependencies.deliveryLimit ?? EVENT_DEFAULT_DELIVERY_LIMIT);
    assertPositiveInteger("claimTtlMs", dependencies.claimTtlMs ?? EVENT_DEFAULT_CLAIM_TTL_MS);
    assertPositiveInteger(
      "claimRenewalIntervalMs",
      dependencies.claimRenewalIntervalMs ?? EVENT_DEFAULT_CLAIM_RENEWAL_INTERVAL_MS,
    );

    const handlersByName = new Map<EventConsumerName, EventHandler>();
    for (const handler of dependencies.handlers) {
      if (handlersByName.has(handler.consumerName)) {
        throw new Error(`Duplicate Event handler registration: ${handler.consumerName}`);
      }
      handlersByName.set(handler.consumerName, handler);
    }

    this.#workerId = dependencies.workerId;
    this.#clock = dependencies.clock;
    this.#codecs = dependencies.codecs;
    this.#consumers = dependencies.consumers;
    this.#handlersByName = handlersByName;
    this.#activeConsumers = Object.freeze([...handlersByName.keys()].sort(compareConsumerNames));
    this.#outbox = dependencies.outbox;
    this.#deliveries = dependencies.deliveries;
    this.#inbox = dependencies.inbox;
    this.#health = dependencies.health;
    this.#claimRenewal = dependencies.claimRenewal;
    this.#fanOutLimit = dependencies.fanOutLimit ?? EVENT_DEFAULT_FAN_OUT_LIMIT;
    this.#deliveryLimit = dependencies.deliveryLimit ?? EVENT_DEFAULT_DELIVERY_LIMIT;
    this.#claimTtlMs = dependencies.claimTtlMs ?? EVENT_DEFAULT_CLAIM_TTL_MS;
    this.#claimRenewalIntervalMs = dependencies.claimRenewalIntervalMs ?? EVENT_DEFAULT_CLAIM_RENEWAL_INTERVAL_MS;
  }

  /** Marks the worker lifecycle as running; Composition calls this on boot. */
  start(): void {
    this.#running = true;
  }

  /** Marks the worker lifecycle as stopped; in-flight work is owned by Composition. */
  stop(): void {
    this.#running = false;
  }

  /** Runs fan-out, delivery attempts, and a due-only retention sweep. */
  async runTick(): Promise<EventTickResult> {
    try {
      const fannedOut = await this.fanOutUndispatchedEvents();
      const deliveries = await this.deliverPendingEvents();
      const retention = await this.runRetentionSweepIfDue();
      this.#consecutiveFailures = 0;
      this.#lastSuccessfulTickAtMs = this.#clock.now();
      return { fannedOut, deliveries, retention };
    } catch (error) {
      this.#consecutiveFailures += 1;
      throw error;
    }
  }

  /** Supplies the complete internal health state without exposing event payloads or causes. */
  async readHealth(): Promise<EventWorkerHealth> {
    const counts = await this.#health.readCounts();
    return {
      workerId: this.#workerId,
      running: this.#running,
      consecutiveFailures: this.#consecutiveFailures,
      lastSuccessfulTickAtMs: this.#lastSuccessfulTickAtMs,
      pendingCount: counts.pendingCount,
      deadLetterCount: counts.deadLetterCount,
    };
  }

  /**
   * Fans out only events with a known codec. An unknown event remains
   * undispatched so a later compatible deployment can safely process it.
   */
  async fanOutUndispatchedEvents(): Promise<number> {
    return this.#outbox.claimAndFanOut({
      workerId: this.#workerId,
      nowMs: this.#clock.now(),
      limit: this.#fanOutLimit,
      consumersFor: (event) => {
        if (this.#codecs.find(event.eventType, event.schemaVersion) === null) {
          return null;
        }
        return deterministicConsumerNames(this.#consumers.consumersFor(event.eventType, event.schemaVersion));
      },
    });
  }

  /** Processes at most one ordered claim at a time per loop iteration. */
  async deliverPendingEvents(): Promise<EventDeliveryTickResult> {
    const result: EventDeliveryTickResult = {
      claimed: 0,
      succeeded: 0,
      alreadyProcessed: 0,
      retried: 0,
      deadLettered: 0,
    };

    if (this.#activeConsumers.length === 0) {
      return result;
    }

    for (let index = 0; index < this.#deliveryLimit; index += 1) {
      const delivery = await this.#deliveries.claimNext({
        workerId: this.#workerId,
        nowMs: this.#clock.now(),
        claimTtlMs: this.#claimTtlMs,
        activeConsumers: this.#activeConsumers,
      });
      if (delivery === null) {
        break;
      }

      result.claimed += 1;
      const outcome = await this.#processClaimedDelivery(delivery);
      if (outcome === "succeeded") {
        result.succeeded += 1;
      } else if (outcome === "already_processed") {
        result.succeeded += 1;
        result.alreadyProcessed += 1;
      } else if (outcome === "retried") {
        result.retried += 1;
      } else {
        result.deadLettered += 1;
      }
    }

    return result;
  }

  /** Token-bound renewal used by the scheduler and by long-running handlers. */
  async renewDeliveryClaim(delivery: ClaimedDelivery): Promise<boolean> {
    return this.#deliveries.renewClaim({
      claimToken: delivery.claimToken,
      workerId: this.#workerId,
      nowMs: this.#clock.now(),
      claimTtlMs: this.#claimTtlMs,
    });
  }

  /** Runs the safe completed-only retention sweep at most once per interval. */
  async runRetentionSweepIfDue(): Promise<EventRetentionSweepResult> {
    const nowMs = this.#clock.now();
    if (!isRetentionSweepDue(this.#lastSuccessfulRetentionSweepAtMs, nowMs)) {
      return { ran: false, deleted: 0 };
    }

    const deleted = await this.#deliveries.sweepRetention({
      beforeMs: retentionBeforeMs(nowMs),
      nowMs,
    });
    this.#lastSuccessfulRetentionSweepAtMs = nowMs;
    return { ran: true, deleted };
  }

  async #processClaimedDelivery(delivery: ClaimedDelivery): Promise<DeliveryOutcome> {
    const handler = this.#handlersByName.get(delivery.consumerName);
    if (handler === undefined) {
      return this.#recordFailure(delivery, new ApplicationError(EVENT_HANDLER_UNAVAILABLE_FAILURE_CODE, false), undefined);
    }

    let renewalLease: EventClaimRenewalLease | undefined;
    let inboxResult: "processed" | "already_processed";
    try {
      renewalLease = this.#claimRenewal?.start({
        delivery,
        intervalMs: this.#claimRenewalIntervalMs,
        renew: () => this.renewDeliveryClaim(delivery),
      });
      const event = this.#decodeEvent(delivery.event);
      inboxResult = await this.#inbox.executeOnce({
        eventId: event.eventId,
        consumerName: delivery.consumerName,
        processedAtMs: this.#clock.now(),
        work: (inboxTransaction) =>
          handler.handle(event, {
            consumerName: delivery.consumerName,
            attempt: delivery.attempt,
            inboxTransaction,
            renewClaim: () => this.renewDeliveryClaim(delivery),
          }),
      });
    } catch (error) {
      await stopClaimRenewal(renewalLease);
      return this.#recordFailure(delivery, error, handler);
    }

    await stopClaimRenewal(renewalLease);
    await this.#deliveries.markSucceeded({
      claimToken: delivery.claimToken,
      workerId: this.#workerId,
      nowMs: this.#clock.now(),
    });
    return inboxResult === "already_processed" ? "already_processed" : "succeeded";
  }

  #decodeEvent(event: PersistedEvent): PersistedEvent {
    const codec = this.#codecs.find(event.eventType, event.schemaVersion);
    if (codec === null) {
      throw new ApplicationError(EVENT_CODEC_UNAVAILABLE_FAILURE_CODE, false);
    }

    try {
      return {
        ...event,
        payload: codec.decode(event.payload),
      };
    } catch {
      throw new ApplicationError(EVENT_CODEC_INVALID_FAILURE_CODE, false);
    }
  }

  async #recordFailure(
    delivery: ClaimedDelivery,
    error: unknown,
    handler: EventHandler | undefined,
  ): Promise<"retried" | "dead_lettered"> {
    const mappedFailure = toEventDeliveryFailure(error);
    const deadLetter = !mappedFailure.retryable || isDeadLetterAttempt(delivery.attempt);
    const failure: EventDeliveryFailure = deadLetter
      ? { ...mappedFailure, retryable: false }
      : mappedFailure;
    const nowMs = this.#clock.now();
    const projectDeadLetter = handler?.projectDeadLetter;

    await this.#deliveries.markFailed({
      claimToken: delivery.claimToken,
      workerId: this.#workerId,
      failure,
      nextAttemptAtMs: deadLetter ? null : nowMs + retryDelayMs(delivery.attempt),
      deadLetter,
      nowMs,
      deadLetterFailureProjector: createDeadLetterFailureProjector(
        deadLetter,
        projectDeadLetter,
        handler,
        delivery,
        failure,
        nowMs,
      ),
    });
    return deadLetter ? "dead_lettered" : "retried";
  }
}

/** Deduplication and lexicographic order make database fan-out reproducible. */
export function deterministicConsumerNames(consumers: readonly EventConsumerName[]): readonly EventConsumerName[] {
  return Object.freeze([...new Set(consumers)].sort(compareConsumerNames));
}

function compareConsumerNames(left: EventConsumerName, right: EventConsumerName): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

async function stopClaimRenewal(renewalLease: EventClaimRenewalLease | undefined): Promise<void> {
  if (renewalLease === undefined) {
    return;
  }
  try {
    await renewalLease.stop();
  } catch {
    // Renewal teardown is best-effort once the claim attempt is terminal.
  }
}

function createDeadLetterFailureProjector(
  deadLetter: boolean,
  projectDeadLetter: EventHandler["projectDeadLetter"] | undefined,
  handler: EventHandler | undefined,
  delivery: ClaimedDelivery,
  failure: EventDeliveryFailure,
  attemptedAt: number,
): ((transaction: EventDeadLetterTransaction) => Promise<void>) | undefined {
  if (!deadLetter || projectDeadLetter === undefined || handler === undefined) {
    return undefined;
  }

  return (transaction) =>
    projectDeadLetter.call(handler, delivery.event, failure, {
      consumerName: delivery.consumerName,
      attemptedAt,
      transaction,
    });
}
