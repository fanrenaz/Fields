import type { EventConsumerName, PersistedEvent } from "./ports/index.js";

export const EVENT_MAX_ATTEMPTS = 10;
export const EVENT_MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;

/** Attempt one waits one second; the tenth failure becomes a dead letter. */
export function retryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("Event delivery attempts must be positive integers.");
  }
  return Math.min(2 ** (attempt - 1) * 1_000, EVENT_MAX_RETRY_DELAY_MS);
}

export function isDeadLetterAttempt(attempt: number): boolean {
  return attempt >= EVENT_MAX_ATTEMPTS;
}

export function deliveryOrderingKey(consumerName: EventConsumerName, event: Pick<PersistedEvent, "aggregateType" | "aggregateId">): string {
  return `${consumerName}:${event.aggregateType}:${event.aggregateId}`;
}
