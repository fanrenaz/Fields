import { setTimeout as sleep } from "node:timers/promises";

import type {
  DurableEventEngine,
  EventTickResult,
  EventWorkerHealth,
} from "../../../application/eventing/index.js";
import { withLifecycleSpan } from "../../../observability/events.js";

export const EVENT_DEFAULT_POLL_INTERVAL_MS = 250;

export type EventWorkerOptions = {
  pollIntervalMs?: number;
  onError?: (error: unknown) => void;
  scheduledTasks?: { runTick(): Promise<{ queued: number; missed: number; cleaned: number }> };
  pushDeliveries?: { runTick(): Promise<{ processed: number }> };
};

/**
 * The Event transport worker only schedules application ticks. Fan-out,
 * retries, claims, and persistence stay in the injected Application and
 * Infrastructure layers; this adapter adds scheduler scan failures to the
 * engine-owned health projection.
 */
export class EventWorker {
  readonly #engine: DurableEventEngine;
  readonly #pollIntervalMs: number;
  readonly #onError: ((error: unknown) => void) | null;
  readonly #scheduledTasks: EventWorkerOptions["scheduledTasks"];
  readonly #pushDeliveries: EventWorkerOptions["pushDeliveries"];
  #scheduledTaskConsecutiveFailures = 0;

  constructor(
    engine: DurableEventEngine,
    options: EventWorkerOptions = {},
  ) {
    if (!Number.isInteger(options.pollIntervalMs ?? EVENT_DEFAULT_POLL_INTERVAL_MS)
      || (options.pollIntervalMs ?? EVENT_DEFAULT_POLL_INTERVAL_MS) < 1) {
      throw new RangeError("pollIntervalMs must be a positive integer.");
    }
    this.#engine = engine;
    this.#pollIntervalMs = options.pollIntervalMs ?? EVENT_DEFAULT_POLL_INTERVAL_MS;
    this.#onError = options.onError ?? null;
    this.#scheduledTasks = options.scheduledTasks;
    this.#pushDeliveries = options.pushDeliveries;
  }

  async run(signal: AbortSignal): Promise<void> {
    this.#engine.start();
    try {
      while (!signal.aborted) {
        let didWork = false;
        try {
          didWork = await this.tick();
        } catch (error) {
          this.#onError?.(error);
        }

        if (!didWork) {
          try {
            await sleep(this.#pollIntervalMs, undefined, { signal });
          } catch (error) {
            if (!signal.aborted) {
              throw error;
            }
          }
        }
      }
    } finally {
      this.#engine.stop();
    }
  }

  async health(): Promise<EventWorkerHealth> {
    const health = await this.#engine.readHealth();
    return {
      ...health,
      consecutiveFailures: health.consecutiveFailures + this.#scheduledTaskConsecutiveFailures,
    };
  }

  /** One testable scheduling unit; scheduler failure does not starve durable Event delivery. */
  async tick(): Promise<boolean> {
    let scheduled: Awaited<ReturnType<NonNullable<EventWorkerOptions["scheduledTasks"]>["runTick"]>> | undefined;
    let scheduledError: unknown = null;
    let pushed = 0;
    try {
      scheduled = await this.#scheduledTasks?.runTick();
      this.#scheduledTaskConsecutiveFailures = 0;
    } catch (error) {
      this.#scheduledTaskConsecutiveFailures += 1;
      scheduledError = error;
    }
    try { pushed = (await this.#pushDeliveries?.runTick())?.processed ?? 0; } catch (error) { this.#scheduledTaskConsecutiveFailures += 1; scheduledError ??= error; }
    const result = await withLifecycleSpan("event.tick", {
      "fields.operation": "event_tick",
    }, () => this.#engine.runTick());
    if (scheduledError !== null) throw scheduledError;
    return pushed > 0 || Boolean(scheduled && (scheduled.queued > 0 || scheduled.missed > 0 || scheduled.cleaned > 0))
      || eventTickDidWork(result);
  }
}

export function eventTickDidWork(result: EventTickResult): boolean {
  return result.fannedOut > 0
    || result.deliveries.claimed > 0
    || result.retention.deleted > 0;
}
