import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../../../../src/application/platform/errors.js";
import type { Clock, EventCodecRegistry } from "../../../../src/application/platform/ports/index.js";

import { DurableEventEngine } from "../../../../src/application/eventing/durable-event-engine.js";
import {
  EVENT_UNKNOWN_DELIVERY_FAILURE_CODE,
  toEventDeliveryFailure,
} from "../../../../src/application/eventing/failure-policy.js";
import type {
  ClaimedDelivery,
  DurableEventEngineDependencies,
  EventClaimRenewalScheduler,
  EventConsumerName,
  EventDeliveryRepository,
  EventHandler,
  EventInboxRepository,
  OutboxDispatchRepository,
  PersistedEvent,
} from "../../../../src/application/eventing/index.js";
import { EVENT_RETENTION_MS, EVENT_RETENTION_SWEEP_INTERVAL_MS } from "../../../../src/application/eventing/retention-policy.js";

const agentRoomExecutionConsumer: EventConsumerName = "runtime.agent-room-execution";

test("fan-out is codec-gated, deterministic, and retains unknown events undispatched", async () => {
  const event = createEvent();
  const unknownEvent = createEvent({ eventId: "event_unknown", eventType: "future.event", schemaVersion: 2 });
  const fanOutConsumers: Array<readonly EventConsumerName[] | null> = [];
  const outbox: OutboxDispatchRepository = {
    async claimAndFanOut(input) {
      fanOutConsumers.push(input.consumersFor(event));
      fanOutConsumers.push(input.consumersFor(unknownEvent));
      return 1;
    },
  };
  const engine = createEngine({
    outbox,
    consumers: {
      consumersFor: () => [agentRoomExecutionConsumer, agentRoomExecutionConsumer],
    },
  });

  assert.equal(await engine.fanOutUndispatchedEvents(), 1);
  assert.deepEqual(fanOutConsumers, [[agentRoomExecutionConsumer], null]);
});

test("delivery orchestration claims serially and exposes only active handlers to the ordered repository", async () => {
  const first = createClaimedDelivery({ event: createEvent({ eventId: "event_1", sequence: 10 }) });
  const second = createClaimedDelivery({ event: createEvent({ eventId: "event_2", sequence: 11 }) });
  const claimedInputs: Array<{ activeConsumers: readonly EventConsumerName[] }> = [];
  const claims: Array<ClaimedDelivery | null> = [first, second, null];
  const handled: string[] = [];
  const succeeded: string[] = [];
  const deliveries = createDeliveryRepository({
    claimNext: async (input) => {
      claimedInputs.push({ activeConsumers: input.activeConsumers });
      return claims.shift() ?? null;
    },
    markSucceeded: async (input) => {
      succeeded.push(input.claimToken);
    },
  });
  const handler: EventHandler = {
    consumerName: agentRoomExecutionConsumer,
    async handle(event) {
      handled.push(event.eventId);
    },
  };
  const engine = createEngine({
    deliveries,
    handlers: [handler],
    deliveryLimit: 3,
  });

  const result = await engine.deliverPendingEvents();

  assert.deepEqual(handled, ["event_1", "event_2"]);
  assert.deepEqual(succeeded, ["claim_event_1", "claim_event_2"]);
  assert.deepEqual(claimedInputs, [
    { activeConsumers: [agentRoomExecutionConsumer] },
    { activeConsumers: [agentRoomExecutionConsumer] },
    { activeConsumers: [agentRoomExecutionConsumer] },
  ]);
  assert.deepEqual(result, {
    claimed: 2,
    succeeded: 2,
    alreadyProcessed: 0,
    retried: 0,
    deadLettered: 0,
  });
});

test("inactive fixed-registry consumers are not claimed as handler failures", async () => {
  let claimCalls = 0;
  const engine = createEngine({
    deliveries: createDeliveryRepository({
      claimNext: async () => {
        claimCalls += 1;
        return createClaimedDelivery();
      },
    }),
    handlers: [],
  });

  const result = await engine.deliverPendingEvents();

  assert.equal(claimCalls, 0);
  assert.deepEqual(result, {
    claimed: 0,
    succeeded: 0,
    alreadyProcessed: 0,
    retried: 0,
    deadLettered: 0,
  });
});

test("claim renewal is token-bound, available to handlers, and stopped after success", async () => {
  const delivery = createClaimedDelivery();
  let scheduledRenew: (() => Promise<boolean>) | undefined;
  let leaseStops = 0;
  const renewCalls: Array<{ claimToken: string; workerId: string; claimTtlMs: number }> = [];
  const claimRenewal: EventClaimRenewalScheduler = {
    start(input) {
      assert.equal(input.intervalMs, 10_000);
      scheduledRenew = input.renew;
      return {
        stop() {
          leaseStops += 1;
        },
      };
    },
  };
  const deliveries = createDeliveryRepository({
    claimNext: async () => delivery,
    renewClaim: async (input) => {
      renewCalls.push(input);
      return true;
    },
  });
  const handler: EventHandler = {
    consumerName: agentRoomExecutionConsumer,
    async handle(_event, context) {
      assert.equal(await context.renewClaim(), true);
    },
  };
  const engine = createEngine({ deliveries, handlers: [handler], claimRenewal, deliveryLimit: 1 });

  await engine.deliverPendingEvents();
  assert.notEqual(scheduledRenew, undefined);
  assert.equal(await scheduledRenew?.(), true);
  assert.equal(leaseStops, 1);
  assert.deepEqual(
    renewCalls.map(({ claimToken, workerId, claimTtlMs }) => ({ claimToken, workerId, claimTtlMs })),
    [
      { claimToken: "claim_event_1", workerId: "event-worker_1", claimTtlMs: 30_000 },
      { claimToken: "claim_event_1", workerId: "event-worker_1", claimTtlMs: 30_000 },
    ],
  );
});

test("unknown handler errors are safely retried without retaining their raw message", async () => {
  const failures: Array<{
    code: string;
    retryable: boolean;
    nextAttemptAtMs: number | null;
    deadLetter: boolean;
  }> = [];
  const deliveries = createDeliveryRepository({
    claimNext: async () => createClaimedDelivery({ attempt: 1 }),
    markFailed: async (input) => {
      failures.push({
        code: input.failure.code,
        retryable: input.failure.retryable,
        nextAttemptAtMs: input.nextAttemptAtMs,
        deadLetter: input.deadLetter,
      });
    },
  });
  const handler: EventHandler = {
    consumerName: agentRoomExecutionConsumer,
    async handle() {
      throw new Error("postgres://user:secret@example.internal/hidden");
    },
  };
  const engine = createEngine({ clock: new FakeClock(10_000), deliveries, handlers: [handler], deliveryLimit: 1 });

  const result = await engine.deliverPendingEvents();

  assert.deepEqual(failures, [
    {
      code: EVENT_UNKNOWN_DELIVERY_FAILURE_CODE,
      retryable: true,
      nextAttemptAtMs: 11_000,
      deadLetter: false,
    },
  ]);
  assert.equal(JSON.stringify(failures).includes("secret"), false);
  assert.deepEqual(result, {
    claimed: 1,
    succeeded: 0,
    alreadyProcessed: 0,
    retried: 1,
    deadLettered: 0,
  });
});

test("the tenth failure dead-letters and invokes its safe failure projector in the terminal transaction", async () => {
  const calls: string[] = [];
  const delivery = createClaimedDelivery({ attempt: 10 });
  const deliveries = createDeliveryRepository({
    claimNext: async () => delivery,
    markFailed: async (input) => {
      assert.equal(input.deadLetter, true);
      assert.equal(input.nextAttemptAtMs, null);
      assert.deepEqual(input.failure, { code: "DEPENDENCY_UNAVAILABLE", retryable: false });
      await input.deadLetterFailureProjector?.({ kind: "event-dead-letter-transaction" });
      calls.push("delivery-transition");
    },
  });
  const handler: EventHandler = {
    consumerName: agentRoomExecutionConsumer,
    async handle() {
      throw new ApplicationError("DEPENDENCY_UNAVAILABLE", true);
    },
    async projectDeadLetter(event, failure, context) {
      assert.equal(event.eventId, delivery.event.eventId);
      assert.deepEqual(failure, { code: "DEPENDENCY_UNAVAILABLE", retryable: false });
      assert.deepEqual(context.transaction, { kind: "event-dead-letter-transaction" });
      calls.push("failure-projector");
    },
  };
  const engine = createEngine({ deliveries, handlers: [handler], deliveryLimit: 1 });

  const result = await engine.deliverPendingEvents();

  assert.deepEqual(calls, ["failure-projector", "delivery-transition"]);
  assert.deepEqual(result, {
    claimed: 1,
    succeeded: 0,
    alreadyProcessed: 0,
    retried: 0,
    deadLettered: 1,
  });
});

test("an existing inbox receipt skips handler effects and still completes the delivery", async () => {
  let handled = 0;
  let succeeded = 0;
  const inbox: EventInboxRepository = {
    async executeOnce() {
      return "already_processed";
    },
  };
  const engine = createEngine({
    deliveries: createDeliveryRepository({
      claimNext: async () => createClaimedDelivery(),
      markSucceeded: async () => {
        succeeded += 1;
      },
    }),
    handlers: [
      {
        consumerName: agentRoomExecutionConsumer,
        async handle() {
          handled += 1;
        },
      },
    ],
    inbox,
    deliveryLimit: 1,
  });

  const result = await engine.deliverPendingEvents();

  assert.equal(handled, 0);
  assert.equal(succeeded, 1);
  assert.deepEqual(result, {
    claimed: 1,
    succeeded: 1,
    alreadyProcessed: 1,
    retried: 0,
    deadLettered: 0,
  });
});

test("retention sweep runs once immediately, then no more often than hourly", async () => {
  const clock = new FakeClock(EVENT_RETENTION_MS + 25_000);
  const sweepInputs: Array<{ beforeMs: number; nowMs: number }> = [];
  const engine = createEngine({
    clock,
    deliveries: createDeliveryRepository({
      sweepRetention: async (input) => {
        sweepInputs.push(input);
        return 3;
      },
    }),
  });

  assert.deepEqual(await engine.runRetentionSweepIfDue(), { ran: true, deleted: 3 });
  assert.deepEqual(await engine.runRetentionSweepIfDue(), { ran: false, deleted: 0 });
  clock.advance(EVENT_RETENTION_SWEEP_INTERVAL_MS - 1);
  assert.deepEqual(await engine.runRetentionSweepIfDue(), { ran: false, deleted: 0 });
  clock.advance(1);
  assert.deepEqual(await engine.runRetentionSweepIfDue(), { ran: true, deleted: 3 });
  assert.deepEqual(sweepInputs, [
    { beforeMs: 25_000, nowMs: EVENT_RETENTION_MS + 25_000 },
    {
      beforeMs: EVENT_RETENTION_SWEEP_INTERVAL_MS + 25_000,
      nowMs: EVENT_RETENTION_MS + EVENT_RETENTION_SWEEP_INTERVAL_MS + 25_000,
    },
  ]);
});

test("worker health reports only worker state and durable backlog counters", async () => {
  const clock = new FakeClock(42_000);
  let shouldFail = false;
  const engine = createEngine({
    clock,
    outbox: {
      async claimAndFanOut() {
        if (shouldFail) {
          throw new Error("database connection detail must not enter health");
        }
        return 0;
      },
    },
    health: {
      async readCounts() {
        return { pendingCount: 7, deadLetterCount: 2 };
      },
    },
  });

  assert.deepEqual(await engine.readHealth(), {
    workerId: "event-worker_1",
    running: false,
    consecutiveFailures: 0,
    lastSuccessfulTickAtMs: 0,
    pendingCount: 7,
    deadLetterCount: 2,
  });
  engine.start();
  await engine.runTick();
  shouldFail = true;
  await assert.rejects(() => engine.runTick());
  engine.stop();
  assert.deepEqual(await engine.readHealth(), {
    workerId: "event-worker_1",
    running: false,
    consecutiveFailures: 1,
    lastSuccessfulTickAtMs: 42_000,
    pendingCount: 7,
    deadLetterCount: 2,
  });
});

test("only stable application errors retain their declared code", () => {
  assert.deepEqual(toEventDeliveryFailure(new ApplicationError("DEPENDENCY_UNAVAILABLE", true)), {
    code: "DEPENDENCY_UNAVAILABLE",
    retryable: true,
  });
  assert.deepEqual(toEventDeliveryFailure(new ApplicationError("not a stable code", false)), {
    code: EVENT_UNKNOWN_DELIVERY_FAILURE_CODE,
    retryable: true,
  });
});

function createEngine(overrides: Partial<DurableEventEngineDependencies> = {}): DurableEventEngine {
  return new DurableEventEngine({
    workerId: "event-worker_1",
    clock: new FakeClock(1_000),
    codecs: createCodecs(),
    consumers: {
      consumersFor: () => [agentRoomExecutionConsumer],
    },
    handlers: [],
    outbox: {
      async claimAndFanOut() {
        return 0;
      },
    },
    deliveries: createDeliveryRepository(),
    inbox: createInboxRepository(),
    health: {
      async readCounts() {
        return { pendingCount: 0, deadLetterCount: 0 };
      },
    },
    ...overrides,
  });
}

function createCodecs(): EventCodecRegistry {
  return {
    find(eventType, schemaVersion) {
      if (eventType !== "company.provisioning_requested.v1" || schemaVersion !== 1) {
        return null;
      }
      return {
        eventType,
        schemaVersion,
        encode: (payload) => payload as Readonly<Record<string, unknown>>,
        decode: (payload) => payload,
      };
    },
  };
}

function createDeliveryRepository(overrides: Partial<EventDeliveryRepository> = {}): EventDeliveryRepository {
  return {
    async claimNext() {
      return null;
    },
    async renewClaim() {
      return true;
    },
    async markSucceeded() {},
    async markFailed() {},
    async sweepRetention() {
      return 0;
    },
    ...overrides,
  };
}

function createInboxRepository(): EventInboxRepository {
  return {
    async executeOnce(input) {
      await input.work({ kind: "event-inbox-transaction" });
      return "processed";
    },
  };
}

function createEvent(overrides: Partial<PersistedEvent> = {}): PersistedEvent {
  return {
    eventId: "event_1",
    eventType: "company.provisioning_requested.v1",
    schemaVersion: 1,
    aggregateType: "company",
    aggregateId: "company_1",
    sequence: 1,
    payload: { company_id: "company_1" },
    occurredAtMs: 100,
    ...overrides,
  };
}

function createClaimedDelivery(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  const event = overrides.event ?? createEvent();
  return {
    event,
    consumerName: agentRoomExecutionConsumer,
    attempt: 1,
    claimToken: `claim_${event.eventId}`,
    claimedUntilMs: 31_000,
    ...overrides,
  };
}

class FakeClock implements Clock {
  #nowMs: number;

  constructor(nowMs: number) {
    this.#nowMs = nowMs;
  }

  now(): number {
    return this.#nowMs;
  }

  advance(milliseconds: number): void {
    this.#nowMs += milliseconds;
  }
}
