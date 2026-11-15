import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const companyMailboxes = pgTable("company_mailboxes", {
  mailboxId: varchar("mailbox_id", { length: 200 }).primaryKey(),
  companyId: varchar("company_id", { length: 100 }).notNull(),
  kind: varchar("kind", { length: 20 }).notNull(),
  targetActorId: varchar("target_actor_id", { length: 100 }),
  displayName: varchar("display_name", { length: 200 }),
  emailAddress: varchar("email_address", { length: 320 }),
  connectionState: varchar("connection_state", { length: 30 }).notNull().default("unconnected"),
  credentialVersion: bigint("credential_version", { mode: "number" }).notNull().default(0),
  capabilityFolders: boolean("capability_folders").notNull().default(false),
  capabilitySearch: boolean("capability_search").notNull().default(false),
  capabilityFlags: boolean("capability_flags").notNull().default(false),
  capabilityMove: boolean("capability_move").notNull().default(false),
  capabilityTrash: boolean("capability_trash").notNull().default(false),
  capabilityAppendSent: boolean("capability_append_sent").notNull().default(false),
  lastCheckedAtMs: bigint("last_checked_at_ms", { mode: "number" }),
  lastErrorCode: varchar("last_error_code", { length: 120 }),
  createdByActorId: varchar("created_by_actor_id", { length: 100 }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("company_mailboxes_personal_actor_unique")
    .on(table.companyId, table.targetActorId)
    .where(sql`${table.kind} = 'personal'`),
  index("company_mailboxes_company_kind_idx").on(table.companyId, table.kind),
  check("company_mailboxes_kind_check", sql`${table.kind} in ('personal', 'shared')`),
  check(
    "company_mailboxes_target_check",
    sql`(${table.kind} = 'personal' and ${table.targetActorId} is not null)
      or (${table.kind} = 'shared' and ${table.targetActorId} is null)`,
  ),
  check(
    "company_mailboxes_connection_state_check",
    sql`${table.connectionState} in ('unconnected', 'validating', 'connected', 'limited', 'error')`,
  ),
  check("company_mailboxes_credential_version_check", sql`${table.credentialVersion} >= 0`),
]);

export const companyMailboxGrants = pgTable("company_mailbox_grants", {
  companyId: varchar("company_id", { length: 100 }).notNull(),
  mailboxId: varchar("mailbox_id", { length: 200 }).notNull()
    .references(() => companyMailboxes.mailboxId, { onDelete: "cascade" }),
  actorId: varchar("actor_id", { length: 100 }).notNull(),
  grantedByActorId: varchar("granted_by_actor_id", { length: 100 }).notNull(),
  grantedAtMs: bigint("granted_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.mailboxId, table.actorId] }),
  index("company_mailbox_grants_company_actor_idx").on(table.companyId, table.actorId),
]);

export const companyMailboxMutationReceipts = pgTable("company_mailbox_mutation_receipts", {
  companyId: varchar("company_id", { length: 100 }).notNull(),
  actorId: varchar("actor_id", { length: 100 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
  operation: varchar("operation", { length: 80 }).notNull(),
  operationId: varchar("operation_id", { length: 200 }).notNull(),
  mailboxId: varchar("mailbox_id", { length: 200 }).notNull()
    .references(() => companyMailboxes.mailboxId, { onDelete: "cascade" }),
  expectedCredentialVersion: bigint("expected_credential_version", { mode: "number" }).notNull(),
  credentialVersion: bigint("credential_version", { mode: "number" }).notNull(),
  previousMailboxJson: text("previous_mailbox_json"),
  requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
  resultJson: text("result_json"),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.companyId, table.actorId, table.idempotencyKey] }),
  uniqueIndex("company_mailbox_mutation_receipts_pending_mailbox_unique")
    .on(table.companyId, table.mailboxId)
    .where(sql`${table.resultJson} is null`),
  check(
    "company_mailbox_mutation_receipts_version_check",
    sql`${table.expectedCredentialVersion} >= 0
      and ${table.credentialVersion} = ${table.expectedCredentialVersion} + 1`,
  ),
]);

export const companyMailboxAuditEvents = pgTable("company_mailbox_audit_events", {
  auditEventId: varchar("audit_event_id", { length: 100 }).primaryKey(),
  companyId: varchar("company_id", { length: 100 }).notNull(),
  mailboxId: varchar("mailbox_id", { length: 200 }),
  actorId: varchar("actor_id", { length: 100 }).notNull(),
  operation: varchar("operation", { length: 80 }).notNull(),
  itemCount: bigint("item_count", { mode: "number" }).notNull().default(0),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  outcome: varchar("outcome", { length: 80 }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("company_mailbox_audit_company_time_idx").on(table.companyId, table.createdAtMs),
  check("company_mailbox_audit_item_count_check", sql`${table.itemCount} >= 0`),
  check("company_mailbox_audit_size_check", sql`${table.sizeBytes} >= 0`),
]);
