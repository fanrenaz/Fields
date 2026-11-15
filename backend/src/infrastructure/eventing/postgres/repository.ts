import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { BackendDatabase } from "../../persistence/postgres/database-service.js";
import type {
  ClaimedDelivery,
  EventConsumerName,
  EventDeadLetterTransaction,
  EventDeliveryFailure,
  EventDeliveryRepository,
  EventHealthRepository,
  EventInboxExecutionResult,
  EventInboxRepository,
  EventInboxTransaction,
  OutboxDispatchRepository,
  PersistedEvent,
} from "../../../application/eventing/ports/index.js";

type BackendTransaction = Parameters<Parameters<BackendDatabase["transaction"]>[0]>[0];

type OutboxEventRow = {
  event_id: string;
  event_type: string;
  schema_version: number | string | bigint;
  aggregate_type: string;
  aggregate_id: string;
  sequence: number | string | bigint;
  payload_json: unknown;
  occurred_at_ms: number | string | bigint;
};

type ClaimedDeliveryRow = OutboxEventRow & {
  consumer_name: string;
  attempt: number | string | bigint;
  claim_token: string;
  claimed_until_ms: number | string | bigint;
};

type DeliveryIdentityRow = {
  event_id: string;
  consumer_name: string;
};

const SAFE_EVENT_FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const FALLBACK_EVENT_FAILURE_CODE = "EVENT_DELIVERY_FAILED";

/**
 * PostgreSQL implementation for the Event process ports. It maps only the
 * durable tables defined in `persistence/postgres/schema/eventing.ts`; all
 * codec, handler, and retry policy decisions remain in Application.
 */
export class PostgresEventingRepository implements
  OutboxDispatchRepository,
  EventDeliveryRepository,
  EventInboxRepository,
  EventHealthRepository {
  constructor(private readonly db: BackendDatabase) {}

  /**
   * Locks undispatched events, invokes the deterministic registry callback,
   * persists every fixed consumer delivery, then marks only known events as
   * dispatched in the same transaction. Unknown codecs deliberately remain
   * undispatched for a future compatible Event deployment.
   */
  async claimAndFanOut(input: {
    workerId: string;
    nowMs: number;
    limit: number;
    consumersFor(event: PersistedEvent): readonly EventConsumerName[] | null;
  }): Promise<number> {
    assertWorkerId(input.workerId);
    assertTimestamp("nowMs", input.nowMs);
    assertPositiveInteger("limit", input.limit);

    return this.db.transaction(async (tx) => {
      const candidates = rowsFromResult<OutboxEventRow>(await tx.execute(sql`
        select event_id, event_type, schema_version, aggregate_type, aggregate_id,
          sequence, payload_json, occurred_at_ms
        from outbox_events
        where dispatched_at_ms is null
        order by sequence asc
        for update skip locked
        limit ${input.limit}
      `));

      let fannedOut = 0;
      for (const candidate of candidates) {
        const event = eventFromRow(candidate);
        const consumers = input.consumersFor(event);
        if (consumers === null) {
          continue;
        }

        for (const consumerName of canonicalConsumerNames(consumers)) {
          await tx.execute(sql`
            insert into outbox_deliveries (
              event_id, consumer_name, status, attempt, next_attempt_at_ms,
              claimed_by, claim_token, claimed_until_ms, last_error_code,
              created_at_ms, updated_at_ms, completed_at_ms
            ) values (
              ${event.eventId}, ${consumerName}, 'pending', 0, ${input.nowMs},
              null, null, null, null,
              ${input.nowMs}, ${input.nowMs}, null
            )
            on conflict (event_id, consumer_name) do nothing
          `);
        }

        const marked = rowsFromResult<{ event_id: string }>(await tx.execute(sql`
          update outbox_events
          set dispatched_at_ms = ${input.nowMs}
          where event_id = ${event.eventId} and dispatched_at_ms is null
          returning event_id
        `));
        if (marked.length === 1) {
          fannedOut += 1;
        }
      }
      return fannedOut;
    });
  }

  /**
   * Claims one active-consumer delivery only when no earlier delivery for its
   * consumer/aggregate remains pending, claimed, or dead-lettered.
   */
  async claimNext(input: {
    workerId: string;
    nowMs: number;
    claimTtlMs: number;
    activeConsumers: readonly EventConsumerName[];
  }): Promise<ClaimedDelivery | null> {
    assertWorkerId(input.workerId);
    assertTimestamp("nowMs", input.nowMs);
    assertPositiveInteger("claimTtlMs", input.claimTtlMs);
    const activeConsumers = canonicalConsumerNames(input.activeConsumers);
    if (activeConsumers.length === 0) {
      return null;
    }

    const claimToken = `event_claim_${randomUUID()}`;
    const claimedUntilMs = safeTimestampSum(input.nowMs, input.claimTtlMs);
    const activeConsumerSql = sql.join(activeConsumers.map((consumer) => sql`${consumer}`), sql`, `);
    const rows = rowsFromResult<ClaimedDeliveryRow>(await this.db.execute(sql`
      with candidate as (
        select delivery.event_id, delivery.consumer_name
        from outbox_deliveries delivery
        join outbox_events event on event.event_id = delivery.event_id
        where delivery.consumer_name in (${activeConsumerSql})
          and (
            (delivery.status = 'pending' and delivery.next_attempt_at_ms <= ${input.nowMs})
            or (
              delivery.status = 'claimed'
              and delivery.claimed_until_ms is not null
              and delivery.claimed_until_ms <= ${input.nowMs}
            )
          )
          and not exists (
            select 1
            from outbox_deliveries earlier_delivery
            join outbox_events earlier_event on earlier_event.event_id = earlier_delivery.event_id
            where earlier_delivery.consumer_name = delivery.consumer_name
              and earlier_event.aggregate_type = event.aggregate_type
              and earlier_event.aggregate_id = event.aggregate_id
              and earlier_event.sequence < event.sequence
              and earlier_delivery.status in ('pending', 'claimed', 'dead_letter')
          )
        order by event.sequence asc, delivery.consumer_name asc
        for update of delivery skip locked
        limit 1
      )
      update outbox_deliveries delivery
      set status = 'claimed',
        claimed_by = ${input.workerId},
        claim_token = ${claimToken},
        claimed_until_ms = ${claimedUntilMs},
        attempt = delivery.attempt + 1,
        updated_at_ms = ${input.nowMs},
        completed_at_ms = null
      from candidate
      join outbox_events event on event.event_id = candidate.event_id
      where delivery.event_id = candidate.event_id
        and delivery.consumer_name = candidate.consumer_name
      returning event.event_id, event.event_type, event.schema_version,
        event.aggregate_type, event.aggregate_id, event.sequence,
        event.payload_json, event.occurred_at_ms,
        delivery.consumer_name, delivery.attempt, delivery.claim_token, delivery.claimed_until_ms
    `));
    const row = rows[0];
    return row === undefined ? null : claimedDeliveryFromRow(row);
  }

  /** Renews only the still-live fence owned by the same Event worker and token. */
  async renewClaim(input: {
    claimToken: string;
    workerId: string;
    nowMs: number;
    claimTtlMs: number;
  }): Promise<boolean> {
    assertClaimToken(input.claimToken);
    assertWorkerId(input.workerId);
    assertTimestamp("nowMs", input.nowMs);
    assertPositiveInteger("claimTtlMs", input.claimTtlMs);
    const claimedUntilMs = safeTimestampSum(input.nowMs, input.claimTtlMs);
    const rows = rowsFromResult<{ event_id: string }>(await this.db.execute(sql`
      update outbox_deliveries
      set claimed_until_ms = ${claimedUntilMs}, updated_at_ms = ${input.nowMs}
      where status = 'claimed'
        and claimed_by = ${input.workerId}
        and claim_token = ${input.claimToken}
        and claimed_until_ms is not null
        and claimed_until_ms >= ${input.nowMs}
      returning event_id
    `));
    return rows.length === 1;
  }

  /** Completes only a still-live claim fence; a lost fence is never silent. */
  async markSucceeded(input: { claimToken: string; workerId: string; nowMs: number }): Promise<void> {
    assertClaimToken(input.claimToken);
    assertWorkerId(input.workerId);
    assertTimestamp("nowMs", input.nowMs);
    const rows = rowsFromResult<{ event_id: string }>(await this.db.execute(sql`
      update outbox_deliveries
      set status = 'succeeded',
        claimed_by = null,
        claim_token = null,
        claimed_until_ms = null,
        last_error_code = null,
        updated_at_ms = ${input.nowMs},
        completed_at_ms = ${input.nowMs}
      where status = 'claimed'
        and claimed_by = ${input.workerId}
        and claim_token = ${input.claimToken}
        and claimed_until_ms is not null
        and claimed_until_ms >= ${input.nowMs}
      returning event_id
    `));
    requireExactlyOneClaim(rows);
  }

  /**
   * Persists a safe retry or terminal failure. A terminal failure first locks
   * the exact claim, invokes the projector, then commits both effects together.
   */
  async markFailed(input: {
    claimToken: string;
    workerId: string;
    failure: EventDeliveryFailure;
    nextAttemptAtMs: number | null;
    deadLetter: boolean;
    nowMs: number;
    deadLetterFailureProjector?: (transaction: EventDeadLetterTransaction) => Promise<void>;
  }): Promise<void> {
    assertClaimToken(input.claimToken);
    assertWorkerId(input.workerId);
    assertTimestamp("nowMs", input.nowMs);
    if (input.deadLetter) {
      if (input.nextAttemptAtMs !== null) {
        throw new RangeError("Dead-letter deliveries cannot have a next attempt timestamp.");
      }
      await this.markDeadLetter({
        ...input,
        deadLetter: true,
        nextAttemptAtMs: null,
      });
      return;
    }
    if (input.nextAttemptAtMs === null) {
      throw new RangeError("Retryable Event delivery failures require a next attempt timestamp.");
    }
    assertTimestamp("nextAttemptAtMs", input.nextAttemptAtMs);
    const rows = rowsFromResult<{ event_id: string }>(await this.db.execute(sql`
      update outbox_deliveries
      set status = 'pending',
        claimed_by = null,
        claim_token = null,
        claimed_until_ms = null,
        next_attempt_at_ms = ${input.nextAttemptAtMs},
        last_error_code = ${safeFailureCode(input.failure.code)},
        updated_at_ms = ${input.nowMs},
        completed_at_ms = null
      where status = 'claimed'
        and claimed_by = ${input.workerId}
        and claim_token = ${input.claimToken}
        and claimed_until_ms is not null
        and claimed_until_ms >= ${input.nowMs}
      returning event_id
    `));
    requireExactlyOneClaim(rows);
  }

  /** Deletes only old, dispatched Events whose complete delivery set succeeded. */
  async sweepRetention(input: { beforeMs: number; nowMs: number }): Promise<number> {
    assertTimestamp("beforeMs", input.beforeMs);
    assertTimestamp("nowMs", input.nowMs);
    if (input.beforeMs > input.nowMs) {
      throw new RangeError("Event retention cutoff cannot be after the current time.");
    }
    const rows = rowsFromResult<{ event_id: string }>(await this.db.execute(sql`
      with candidates as (
        select event.event_id
        from outbox_events event
        where event.dispatched_at_ms is not null
          and event.occurred_at_ms < ${input.beforeMs}
          and not exists (
            select 1
            from outbox_deliveries delivery
            where delivery.event_id = event.event_id
              and delivery.status <> 'succeeded'
          )
        for update of event skip locked
      )
      delete from outbox_events event
      using candidates
      where event.event_id = candidates.event_id
      returning event.event_id
    `));
    return rows.length;
  }

  /** Reads the two database-backed health counters without exposing payloads. */
  async readCounts(): Promise<{ pendingCount: number; deadLetterCount: number }> {
    const rows = rowsFromResult<{
      pending_count: number | string | bigint;
      dead_letter_count: number | string | bigint;
    }>(await this.db.execute(sql`
      select
        (
          (select count(*) from outbox_events where dispatched_at_ms is null)
          +
          (
            select count(*)
            from outbox_deliveries
            where status in ('pending', 'claimed')
          )
        ) as pending_count,
        (
          select count(*)
          from outbox_deliveries
          where status = 'dead_letter'
        ) as dead_letter_count
    `));
    const row = rows[0];
    if (row === undefined) {
      throw new PostgresEventingPersistenceError(
        "EVENT_HEALTH_COUNTS_MISSING",
        "Event health counters could not be read.",
      );
    }
    return {
      pendingCount: nonNegativeNumberFromDb(row.pending_count, "pending_count"),
      deadLetterCount: nonNegativeNumberFromDb(row.dead_letter_count, "dead_letter_count"),
    };
  }

  private async markDeadLetter(input: {
    claimToken: string;
    workerId: string;
    failure: EventDeliveryFailure;
    nextAttemptAtMs: null;
    deadLetter: true;
    nowMs: number;
    deadLetterFailureProjector?: (transaction: EventDeadLetterTransaction) => Promise<void>;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const locked = rowsFromResult<DeliveryIdentityRow>(await tx.execute(sql`
        select event_id, consumer_name
        from outbox_deliveries
        where status = 'claimed'
          and claimed_by = ${input.workerId}
          and claim_token = ${input.claimToken}
          and claimed_until_ms is not null
          and claimed_until_ms >= ${input.nowMs}
        for update
      `));
      const identity = locked[0];
      if (identity === undefined) {
        throw new PostgresEventClaimLostError();
      }

      if (input.deadLetterFailureProjector !== undefined) {
        await input.deadLetterFailureProjector(new PostgresEventDeadLetterTransaction(tx));
      }

      const updated = rowsFromResult<{ event_id: string }>(await tx.execute(sql`
        update outbox_deliveries
        set status = 'dead_letter',
          claimed_by = null,
          claim_token = null,
          claimed_until_ms = null,
          last_error_code = ${safeFailureCode(input.failure.code)},
          updated_at_ms = ${input.nowMs},
          completed_at_ms = ${input.nowMs}
        where event_id = ${identity.event_id}
          and consumer_name = ${identity.consumer_name}
          and status = 'claimed'
          and claimed_by = ${input.workerId}
          and claim_token = ${input.claimToken}
          and claimed_until_ms is not null
          and claimed_until_ms >= ${input.nowMs}
        returning event_id
      `));
      requireExactlyOneClaim(updated);
    });
  }

  /**
   * Inserts an Inbox receipt before handler work inside one transaction. A
   * concurrent delivery blocks at the unique key, then observes the committed
   * receipt and skips duplicate handler work.
   */
  async executeOnce(input: {
    eventId: string;
    consumerName: EventConsumerName;
    processedAtMs: number;
    work(transaction: EventInboxTransaction): Promise<void>;
  }): Promise<EventInboxExecutionResult> {
    assertIdentifier("eventId", input.eventId);
    assertTimestamp("processedAtMs", input.processedAtMs);
    return this.db.transaction(async (tx) => {
      const inserted = rowsFromResult<{ event_id: string }>(await tx.execute(sql`
        insert into event_inbox (event_id, consumer_name, processed_at_ms)
        values (${input.eventId}, ${input.consumerName}, ${input.processedAtMs})
        on conflict (event_id, consumer_name) do nothing
        returning event_id
      `));
      if (inserted.length === 0) {
        return "already_processed";
      }
      await input.work(new PostgresEventInboxTransaction(tx));
      return "processed";
    });
  }
}

/** Concrete transaction capability for Infrastructure Event handlers. */
export class PostgresEventInboxTransaction implements EventInboxTransaction {
  readonly kind = "event-inbox-transaction" as const;

  constructor(readonly executor: BackendTransaction) {}

  async execute<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
    return rowsFromResult<T>(await this.executor.execute(query));
  }
}

/** Concrete transaction capability for Infrastructure dead-letter projectors. */
export class PostgresEventDeadLetterTransaction implements EventDeadLetterTransaction {
  readonly kind = "event-dead-letter-transaction" as const;

  constructor(readonly executor: BackendTransaction) {}

  async execute<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
    return rowsFromResult<T>(await this.executor.execute(query));
  }
}

export class PostgresEventingPersistenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PostgresEventingPersistenceError";
  }
}

export class PostgresEventClaimLostError extends PostgresEventingPersistenceError {
  constructor() {
    super("EVENT_DELIVERY_CLAIM_LOST", "The Event delivery claim is no longer owned by this worker.");
    this.name = "PostgresEventClaimLostError";
  }
}

function eventFromRow(row: OutboxEventRow): PersistedEvent {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    schemaVersion: nonNegativeNumberFromDb(row.schema_version, "schema_version"),
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    sequence: nonNegativeNumberFromDb(row.sequence, "sequence"),
    payload: jsonFromDb(row.payload_json),
    occurredAtMs: nonNegativeNumberFromDb(row.occurred_at_ms, "occurred_at_ms"),
  };
}

function claimedDeliveryFromRow(row: ClaimedDeliveryRow): ClaimedDelivery {
  return {
    event: eventFromRow(row),
    consumerName: eventConsumerNameFromDb(row.consumer_name),
    attempt: positiveNumberFromDb(row.attempt, "attempt"),
    claimToken: row.claim_token,
    claimedUntilMs: nonNegativeNumberFromDb(row.claimed_until_ms, "claimed_until_ms"),
  };
}

function canonicalConsumerNames(consumers: readonly EventConsumerName[]): readonly EventConsumerName[] {
  return Object.freeze([...new Set(consumers)].sort((left, right) => left.localeCompare(right)));
}

function eventConsumerNameFromDb(value: string): EventConsumerName {
  if (
    value === "runtime.agent-room-execution"
    || value === "runtime.agent-room-interaction-response"
    || value === "runtime.agent-member-cleanup"
    || value === "runtime.scheduled-task"
  ) {
    return value;
  }
  throw new PostgresEventingPersistenceError(
    "EVENT_CONSUMER_INVALID",
    "Event delivery has an unsupported consumer name.",
  );
}

function safeFailureCode(value: string): string {
  return SAFE_EVENT_FAILURE_CODE.test(value) ? value : FALLBACK_EVENT_FAILURE_CODE;
}

function requireExactlyOneClaim(rows: readonly unknown[]): void {
  if (rows.length !== 1) {
    throw new PostgresEventClaimLostError();
  }
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }
  return [];
}

function jsonFromDb(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function nonNegativeNumberFromDb(value: number | string | bigint, field: string): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new PostgresEventingPersistenceError(
      "EVENT_DATABASE_VALUE_INVALID",
      `Event ${field} is not a non-negative safe integer.`,
    );
  }
  return numberValue;
}

function positiveNumberFromDb(value: number | string | bigint, field: string): number {
  const numberValue = nonNegativeNumberFromDb(value, field);
  if (numberValue < 1) {
    throw new PostgresEventingPersistenceError(
      "EVENT_DATABASE_VALUE_INVALID",
      `Event ${field} is not a positive integer.`,
    );
  }
  return numberValue;
}

function assertTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function assertWorkerId(value: string): void {
  assertIdentifier("workerId", value);
}

function assertClaimToken(value: string): void {
  assertIdentifier("claimToken", value);
}

function assertIdentifier(name: string, value: string): void {
  if (value.trim().length === 0 || value.length > 128) {
    throw new RangeError(`${name} must be a non-empty identifier up to 128 characters.`);
  }
}

function safeTimestampSum(nowMs: number, durationMs: number): number {
  const value = nowMs + durationMs;
  assertTimestamp("claimedUntilMs", value);
  return value;
}
