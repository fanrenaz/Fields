export type EventConsumerName =
  | "runtime.agent-room-execution"
  | "runtime.agent-room-interaction-response"
  | "runtime.agent-member-cleanup"
  | "runtime.scheduled-task";

export type PersistedEvent = {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  sequence: number;
  payload: unknown;
  occurredAtMs: number;
};

export type DeliveryStatus = "pending" | "claimed" | "succeeded" | "dead_letter";

export type ClaimedDelivery = {
  event: PersistedEvent;
  consumerName: EventConsumerName;
  attempt: number;
  claimToken: string;
  claimedUntilMs: number;
};

export type EventDeliveryFailure = {
  code: string;
  retryable: boolean;
};

export type EventInboxExecutionResult = "processed" | "already_processed";

/**
 * Opaque transaction capability supplied to a database-backed handler. The
 * Event Inbox implementation owns the actual transaction and commits the
 * receipt together with the handler's database effects.
 */
export interface EventInboxTransaction {
  readonly kind: "event-inbox-transaction";
}

/**
 * Opaque transaction capability supplied only while a dead-letter failure
 * projector is running. The delivery repository owns the transaction that
 * also changes the delivery to dead_letter.
 */
export interface EventDeadLetterTransaction {
  readonly kind: "event-dead-letter-transaction";
}

export type EventHandlingContext = {
  consumerName: EventConsumerName;
  attempt: number;
  inboxTransaction: EventInboxTransaction;
  renewClaim(): Promise<boolean>;
};

export type EventDeadLetterContext = {
  consumerName: EventConsumerName;
  attemptedAt: number;
  transaction: EventDeadLetterTransaction;
};

/**
 * The registry is fixed by Composition. Fan-out must retain every registered
 * consumer even when its handler is not active yet, so a later deployment can
 * drain the durable pending delivery.
 */
export interface EventConsumerRegistry {
  consumersFor(eventType: string, schemaVersion: number): readonly EventConsumerName[];
}

/**
 * Claims undispatched events and inserts their deliveries in one persistence
 * transaction. The callback is synchronous and deterministic; an adapter
 * invokes it while it owns the outbox row lock, then marks the event
 * dispatched in that same transaction. Returning null means the event cannot
 * yet be decoded by this deployment and must remain undispatched; returning
 * an empty array is a valid, dispatched event with no registered consumers.
 */
export interface OutboxDispatchRepository {
  claimAndFanOut(input: {
    workerId: string;
    nowMs: number;
    limit: number;
    consumersFor(event: PersistedEvent): readonly EventConsumerName[] | null;
  }): Promise<number>;
}

/**
 * Claiming must refuse a delivery if an earlier delivery for the same
 * consumer/aggregate is pending, claimed, or dead-lettered. It must also
 * claim only the supplied active consumers; inactive fixed-registry consumers
 * remain pending without being treated as handler failures.
 */
export interface EventDeliveryRepository {
  claimNext(input: {
    workerId: string;
    nowMs: number;
    claimTtlMs: number;
    activeConsumers: readonly EventConsumerName[];
  }): Promise<ClaimedDelivery | null>;
  renewClaim(input: { claimToken: string; workerId: string; nowMs: number; claimTtlMs: number }): Promise<boolean>;
  markSucceeded(input: { claimToken: string; workerId: string; nowMs: number }): Promise<void>;
  markFailed(input: {
    claimToken: string;
    workerId: string;
    failure: EventDeliveryFailure;
    nextAttemptAtMs: number | null;
    deadLetter: boolean;
    nowMs: number;
    /**
     * When deadLetter is true, the repository invokes this projector in the
     * same transaction as the terminal delivery transition. It is omitted for
     * retryable failures.
     */
    deadLetterFailureProjector?: (transaction: EventDeadLetterTransaction) => Promise<void>;
  }): Promise<void>;
  /** Deletes only completed, non-dead-letter retention candidates. */
  sweepRetention(input: { beforeMs: number; nowMs: number }): Promise<number>;
}

/**
 * A database implementation executes work and writes the inbox receipt in
 * one transaction. External-runtime handlers may use the same abstraction,
 * but must make their remote side effect naturally idempotent before the
 * receipt is written.
 */
export interface EventInboxRepository {
  executeOnce(input: {
    eventId: string;
    consumerName: EventConsumerName;
    processedAtMs: number;
    work(transaction: EventInboxTransaction): Promise<void>;
  }): Promise<EventInboxExecutionResult>;
}

/**
 * Read-only Event worker counters. pendingCount includes undispatched outbox
 * events plus pending or claimed deliveries; dead-letter deliveries are
 * reported separately and must not be folded into pendingCount.
 */
export interface EventHealthRepository {
  readCounts(): Promise<{ pendingCount: number; deadLetterCount: number }>;
}

export interface EventHandler {
  readonly consumerName: EventConsumerName;
  handle(event: PersistedEvent, context: EventHandlingContext): Promise<void>;
  projectDeadLetter?(
    event: PersistedEvent,
    failure: EventDeliveryFailure,
    context: EventDeadLetterContext,
  ): Promise<void>;
}

export interface EventClaimRenewalLease {
  stop(): void | Promise<void>;
}

/**
 * Composition supplies the 10-second timer policy. The application engine
 * supplies the safe, token-bound renewal operation and always stops the lease
 * when the delivery attempt finishes.
 */
export interface EventClaimRenewalScheduler {
  start(input: {
    delivery: ClaimedDelivery;
    intervalMs: number;
    renew(): Promise<boolean>;
  }): EventClaimRenewalLease;
}
