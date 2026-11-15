import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/** Durable platform event log. Payloads are serialized only by registered codecs. */
export const outboxEvents = pgTable("outbox_events", {
  eventId: varchar("event_id", { length: 128 }).primaryKey(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  schemaVersion: bigint("schema_version", { mode: "number" }).notNull(),
  aggregateType: varchar("aggregate_type", { length: 128 }).notNull(),
  aggregateId: varchar("aggregate_id", { length: 128 }).notNull(),
  sequence: bigserial("sequence", { mode: "number" }).notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  occurredAtMs: bigint("occurred_at_ms", { mode: "number" }).notNull(),
  dispatchedAtMs: bigint("dispatched_at_ms", { mode: "number" }),
}, (table) => [
  uniqueIndex("outbox_events_sequence_unique").on(table.sequence),
  index("outbox_events_dispatch_sequence_idx").on(table.dispatchedAtMs, table.sequence),
  index("outbox_events_aggregate_sequence_idx").on(
    table.aggregateType,
    table.aggregateId,
    table.sequence,
  ),
  check("outbox_events_schema_version_check", sql`${table.schemaVersion} >= 0`),
]);

/** One delivery state per event and fixed consumer registry entry. */
export const outboxDeliveries = pgTable("outbox_deliveries", {
  eventId: varchar("event_id", { length: 128 })
    .notNull()
    .references(() => outboxEvents.eventId, { onDelete: "cascade" }),
  consumerName: varchar("consumer_name", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  attempt: bigint("attempt", { mode: "number" }).notNull().default(0),
  nextAttemptAtMs: bigint("next_attempt_at_ms", { mode: "number" }).notNull(),
  claimedBy: varchar("claimed_by", { length: 128 }),
  claimToken: varchar("claim_token", { length: 128 }),
  claimedUntilMs: bigint("claimed_until_ms", { mode: "number" }),
  lastErrorCode: varchar("last_error_code", { length: 128 }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  completedAtMs: bigint("completed_at_ms", { mode: "number" }),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.consumerName] }),
  index("outbox_deliveries_consumer_claim_idx").on(
    table.consumerName,
    table.status,
    table.nextAttemptAtMs,
    table.claimedUntilMs,
  ),
  index("outbox_deliveries_status_updated_idx").on(table.status, table.updatedAtMs),
  check(
    "outbox_deliveries_status_check",
    sql`${table.status} in ('pending', 'claimed', 'succeeded', 'dead_letter')`,
  ),
  check("outbox_deliveries_attempt_check", sql`${table.attempt} >= 0`),
]);

/** Idempotency receipt committed with each database-backed event handler write. */
export const eventInbox = pgTable("event_inbox", {
  eventId: varchar("event_id", { length: 128 })
    .notNull()
    .references(() => outboxEvents.eventId, { onDelete: "cascade" }),
  consumerName: varchar("consumer_name", { length: 128 }).notNull(),
  processedAtMs: bigint("processed_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.consumerName] }),
  index("event_inbox_consumer_processed_idx").on(table.consumerName, table.processedAtMs),
]);
