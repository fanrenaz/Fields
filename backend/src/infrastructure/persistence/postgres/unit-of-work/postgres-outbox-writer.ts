import { sql } from "drizzle-orm";

import { ApplicationError, isApplicationError } from "../../../../application/platform/errors.js";
import type {
  EventCodecRegistry,
  OutboxTransaction,
  OutboxWriter,
  VersionedOutboxEvent,
} from "../../../../application/platform/ports/index.js";
import type { BackendDatabase } from "../database-service.js";


export const OUTBOX_EVENT_INVALID_CODE = "OUTBOX_EVENT_INVALID";
export const OUTBOX_EVENT_CODEC_UNAVAILABLE_CODE = "OUTBOX_EVENT_CODEC_UNAVAILABLE";
export const OUTBOX_EVENT_CODEC_INVALID_CODE = "OUTBOX_EVENT_CODEC_INVALID";
export const OUTBOX_WRITE_FAILED_CODE = "OUTBOX_WRITE_FAILED";

type DatabaseExecutor = Pick<BackendDatabase, "execute">;

/** Supplied by the PostgreSQL UoW from Composition; never exposed to Application. */
export type PostgresOutboxTransactionResolver = (transaction: OutboxTransaction) => DatabaseExecutor;

/**
 * Serializes only registered, versioned payloads and executes the insert on
 * the opaque UoW transaction. It never creates its own transaction, which is
 * what makes an owner fact and its Outbox event atomic.
 */
export class PostgresOutboxWriter implements OutboxWriter {
  constructor(
    private readonly codecs: EventCodecRegistry,
    private readonly resolveTransaction: PostgresOutboxTransactionResolver,
  ) {}

  async append(transaction: OutboxTransaction, event: VersionedOutboxEvent): Promise<void> {
    try {
      assertEventShape(event);
      const payloadJson = this.encodePayload(event);
      const databaseTransaction = this.resolveTransaction(transaction);
      await databaseTransaction.execute(sql`
        insert into outbox_events (
          event_id, event_type, schema_version, aggregate_type, aggregate_id,
          payload_json, occurred_at_ms, dispatched_at_ms
        ) values (
          ${event.eventId}, ${event.eventType}, ${event.schemaVersion},
          ${event.aggregateType}, ${event.aggregateId}, ${payloadJson}::jsonb,
          ${event.occurredAtMs}, null
        )
      `);
    } catch (error) {
      if (isApplicationError(error)) {
        throw error;
      }
      throw new ApplicationError(OUTBOX_WRITE_FAILED_CODE, true);
    }
  }

  private encodePayload(event: VersionedOutboxEvent): string {
    const codec = this.codecs.find(event.eventType, event.schemaVersion);
    if (!codec) {
      throw new ApplicationError(OUTBOX_EVENT_CODEC_UNAVAILABLE_CODE, false);
    }
    try {
      const encoded = codec.encode(event.payload);
      if (!isRecord(encoded)) {
        throw new ApplicationError(OUTBOX_EVENT_CODEC_INVALID_CODE, false);
      }
      const serialized = JSON.stringify(encoded);
      if (serialized === undefined) {
        throw new ApplicationError(OUTBOX_EVENT_CODEC_INVALID_CODE, false);
      }
      const parsed: unknown = JSON.parse(serialized);
      if (!isRecord(parsed)) {
        throw new ApplicationError(OUTBOX_EVENT_CODEC_INVALID_CODE, false);
      }
      return serialized;
    } catch (error) {
      if (isApplicationError(error)) {
        throw error;
      }
      throw new ApplicationError(OUTBOX_EVENT_CODEC_INVALID_CODE, false);
    }
  }
}

function assertEventShape(event: VersionedOutboxEvent): void {
  assertIdentifier(event.eventId);
  assertIdentifier(event.eventType);
  assertIdentifier(event.aggregateType);
  assertIdentifier(event.aggregateId);
  assertNonNegativeInteger(event.schemaVersion);
  assertNonNegativeInteger(event.occurredAtMs);
}

function assertIdentifier(value: string): void {
  if (value.trim().length === 0 || value.length > 128) {
    throw new ApplicationError(OUTBOX_EVENT_INVALID_CODE, false);
  }
}

function assertNonNegativeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApplicationError(OUTBOX_EVENT_INVALID_CODE, false);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
