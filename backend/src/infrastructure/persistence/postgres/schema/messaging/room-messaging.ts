import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { actors } from "../actor.js";
import { rooms } from "../room.js";
import type { AgentRoomCompanyFileSnapshot } from "@fields/contracts/internal/agent-room";
import type { RoomMessageImageAttachment } from "@fields/contracts/public/room";

export const roomMessages = pgTable("room_messages", {
  messageId: varchar("message_id", { length: 128 }).primaryKey(),
  roomId: varchar("room_id", { length: 128 }).notNull(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  eventSequence: bigint("event_sequence", { mode: "number" }).notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  senderMemberId: varchar("sender_member_id", { length: 128 }),
  senderType: varchar("sender_type", { length: 32 }).notNull(),
  clientMessageId: varchar("client_message_id", { length: 128 }),
  markdown: text("markdown").notNull(),
  plainText: text("plain_text").notNull(),
  replyToMessageIdsJson: jsonb("reply_to_message_ids_json").notNull().default(sql`'[]'::jsonb`),
  referencesJson: jsonb("references_json").notNull().default(sql`'[]'::jsonb`),
  imageAttachmentsJson: jsonb("image_attachments_json")
    .$type<RoomMessageImageAttachment[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  threadId: varchar("thread_id", { length: 128 }),
  triggerMessageId: varchar("trigger_message_id", { length: 128 }),
  sourceExecutionId: varchar("source_execution_id", { length: 128 })
    .references((): AnyPgColumn => agentRoomExecutions.executionId, { onDelete: "set null" }),
  sourceCascadeId: varchar("source_cascade_id", { length: 128 })
    .references((): AnyPgColumn => agentRoomCascades.cascadeId, { onDelete: "set null" }),
  versionGroupId: varchar("version_group_id", { length: 128 }),
  versionNumber: bigint("version_number", { mode: "number" }),
  editedAtMs: bigint("edited_at_ms", { mode: "number" }),
  deletedAtMs: bigint("deleted_at_ms", { mode: "number" }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("room_messages_room_sequence_unique").on(table.roomId, table.sequence),
  uniqueIndex("room_messages_room_event_sequence_unique").on(table.roomId, table.eventSequence),
  uniqueIndex("room_messages_client_idempotency_unique")
    .on(table.roomId, table.senderMemberId, table.clientMessageId)
    .where(sql`${table.clientMessageId} is not null`),
  index("room_messages_room_created_idx").on(table.roomId, table.createdAtMs),
  index("room_messages_plain_text_idx").on(table.roomId, table.sequence),
  uniqueIndex("room_messages_agent_version_unique")
    .on(table.versionGroupId, table.versionNumber)
    .where(sql`${table.versionGroupId} is not null`),
  uniqueIndex("room_messages_version_group_message_unique")
    .on(table.versionGroupId, table.messageId),
  foreignKey({
    columns: [table.roomId, table.companyId],
    foreignColumns: [rooms.id, rooms.companyId],
    name: "room_messages_room_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.companyId, table.senderMemberId],
    foreignColumns: [actors.companyId, actors.id],
    name: "room_messages_sender_member_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.triggerMessageId],
    foreignColumns: [table.messageId],
    name: "room_messages_trigger_message_fk",
  }).onDelete("set null"),
  check("room_messages_sequence_check", sql`${table.sequence} > 0`),
  check("room_messages_event_sequence_check", sql`${table.eventSequence} > 0`),
  check("room_messages_revision_check", sql`${table.revision} > 0`),
  check(
    "room_messages_version_shape_check",
    sql`(
      (${table.versionGroupId} is null and ${table.versionNumber} is null)
      or (
        ${table.senderType} = 'agent'
        and ${table.versionGroupId} is not null
        and ${table.versionNumber} > 0
      )
    )`,
  ),
  check("room_messages_sender_type_check", sql`${table.senderType} in ('human', 'agent', 'system')`),
  check(
    "room_messages_sender_shape_check",
    sql`(
      (${table.senderType} = 'system' and ${table.senderMemberId} is null)
      or (${table.senderType} <> 'system' and ${table.senderMemberId} is not null)
    )`,
  ),
]);

/**
 * One durable Codex thread/cursor per Agent-Room pair. Membership activation
 * changes eligibility but does not discard the thread or previously consumed
 * cursor.
 */
export const agentRoomStates = pgTable("agent_room_states", {
  roomId: varchar("room_id", { length: 128 }).notNull(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  agentMemberId: varchar("agent_member_id", { length: 128 }).notNull(),
  triggerPolicy: varchar("trigger_policy", { length: 32 }).notNull().default("human_explicit"),
  triggerPolicyVersion: bigint("trigger_policy_version", { mode: "number" }).notNull().default(1),
  threadId: varchar("thread_id", { length: 128 }),
  cursorSequence: bigint("cursor_sequence", { mode: "number" }).notNull().default(0),
  eligibleFromSequence: bigint("eligible_from_sequence", { mode: "number" }).notNull().default(1),
  membershipActive: boolean("membership_active").notNull().default(true),
  membershipVersion: bigint("membership_version", { mode: "number" }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomId, table.agentMemberId] }),
  uniqueIndex("agent_room_states_thread_unique")
    .on(table.companyId, table.threadId)
    .where(sql`${table.threadId} is not null`),
  index("agent_room_states_agent_idx").on(table.companyId, table.agentMemberId),
  foreignKey({
    columns: [table.roomId, table.companyId],
    foreignColumns: [rooms.id, rooms.companyId],
    name: "agent_room_states_room_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.companyId, table.agentMemberId],
    foreignColumns: [actors.companyId, actors.id],
    name: "agent_room_states_agent_member_fk",
  }).onDelete("cascade"),
  check(
    "agent_room_states_trigger_policy_check",
    sql`${table.triggerPolicy} in ('human_explicit', 'member_explicit', 'human_auto', 'member_auto', 'human_explicit_agent_auto', 'agent_explicit_human_auto')`,
  ),
  check(
    "agent_room_states_cursor_check",
    sql`${table.cursorSequence} >= 0 and ${table.eligibleFromSequence} > 0`,
  ),
  check("agent_room_states_trigger_policy_version_check", sql`${table.triggerPolicyVersion} > 0`),
  check("agent_room_states_membership_version_check", sql`${table.membershipVersion} > 0`),
]);

export const agentRoomCascades = pgTable("agent_room_cascades", {
  cascadeId: varchar("cascade_id", { length: 128 }).primaryKey(),
  roomId: varchar("room_id", { length: 128 }).notNull(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  sourceMessageId: varchar("source_message_id", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  completedAtMs: bigint("completed_at_ms", { mode: "number" }),
}, (table) => [
  index("agent_room_cascades_room_status_idx").on(table.roomId, table.status),
  foreignKey({
    columns: [table.roomId, table.companyId],
    foreignColumns: [rooms.id, rooms.companyId],
    name: "agent_room_cascades_room_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.sourceMessageId],
    foreignColumns: [roomMessages.messageId],
    name: "agent_room_cascades_source_message_fk",
  }).onDelete("cascade"),
  check(
    "agent_room_cascades_status_check",
    sql`${table.status} in ('active', 'silent_completed', 'failed')`,
  ),
]);

export const agentRoomExecutions = pgTable("agent_room_executions", {
  executionId: varchar("execution_id", { length: 128 }).primaryKey(),
  roomId: varchar("room_id", { length: 128 }).notNull(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  agentMemberId: varchar("agent_member_id", { length: 128 }).notNull(),
  cascadeId: varchar("cascade_id", { length: 128 }).notNull(),
  sourceMessageId: varchar("source_message_id", { length: 128 }).notNull(),
  sourceExecutionId: varchar("source_execution_id", { length: 128 })
    .references((): AnyPgColumn => agentRoomExecutions.executionId, { onDelete: "set null" }),
  codexTurnId: varchar("codex_turn_id", { length: 128 }),
  turnMessageId: varchar("turn_message_id", { length: 128 })
    .references((): AnyPgColumn => roomMessages.messageId, { onDelete: "set null" }),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
  trigger: varchar("trigger", { length: 32 }).notNull(),
  triggerPolicy: varchar("trigger_policy", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  fromSequence: bigint("from_sequence", { mode: "number" }).notNull(),
  throughSequence: bigint("through_sequence", { mode: "number" }).notNull(),
  threadId: varchar("thread_id", { length: 128 }),
  attempt: bigint("attempt", { mode: "number" }).notNull().default(0),
  publishedMessageCount: bigint("published_message_count", { mode: "number" }).notNull().default(0),
  companyFileInputs: jsonb("company_file_inputs_json").$type<AgentRoomCompanyFileSnapshot[]>(),
  lastErrorCode: varchar("last_error_code", { length: 128 }),
  lastErrorRetryable: boolean("last_error_retryable"),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  startedAtMs: bigint("started_at_ms", { mode: "number" }),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  completedAtMs: bigint("completed_at_ms", { mode: "number" }),
}, (table) => [
  uniqueIndex("agent_room_executions_idempotency_unique").on(table.idempotencyKey),
  index("agent_room_executions_dispatch_idx").on(table.status, table.createdAtMs),
  index("agent_room_executions_agent_room_idx").on(
    table.roomId,
    table.agentMemberId,
    table.createdAtMs,
  ),
  foreignKey({
    columns: [table.roomId, table.companyId],
    foreignColumns: [rooms.id, rooms.companyId],
    name: "agent_room_executions_room_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.companyId, table.agentMemberId],
    foreignColumns: [actors.companyId, actors.id],
    name: "agent_room_executions_agent_member_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.cascadeId],
    foreignColumns: [agentRoomCascades.cascadeId],
    name: "agent_room_executions_cascade_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.sourceMessageId],
    foreignColumns: [roomMessages.messageId],
    name: "agent_room_executions_source_message_fk",
  }).onDelete("cascade"),
  check(
    "agent_room_executions_trigger_policy_check",
    sql`${table.triggerPolicy} in ('human_explicit', 'member_explicit', 'human_auto', 'member_auto', 'human_explicit_agent_auto', 'agent_explicit_human_auto')`,
  ),
  check(
    "agent_room_executions_trigger_check",
    sql`${table.trigger} in ('mention', 'direct_reply', 'automatic')`,
  ),
  check(
    "agent_room_executions_status_check",
    sql`${table.status} in ('pending', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled')`,
  ),
  check(
    "agent_room_executions_sequence_check",
    sql`${table.fromSequence} > 0 and ${table.throughSequence} >= ${table.fromSequence}`,
  ),
  check(
    "agent_room_executions_counts_check",
    sql`${table.attempt} >= 0 and ${table.publishedMessageCount} >= 0`,
  ),
]);

export const roomMessageRevisions = pgTable("room_message_revisions", {
  messageId: varchar("message_id", { length: 128 }).notNull()
    .references(() => roomMessages.messageId, { onDelete: "cascade" }),
  revision: bigint("revision", { mode: "number" }).notNull(),
  editorMemberId: varchar("editor_member_id", { length: 128 }).notNull(),
  markdown: text("markdown").notNull(),
  plainText: text("plain_text").notNull(),
  deleted: boolean("deleted").notNull().default(false),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.revision] }),
  check("room_message_revisions_revision_check", sql`${table.revision} > 0`),
  foreignKey({
    columns: [table.editorMemberId],
    foreignColumns: [actors.id],
    name: "room_message_revisions_editor_fk",
  }).onDelete("restrict"),
]);

export const roomAgentReplyVersionGroups = pgTable("room_agent_reply_version_groups", {
  versionGroupId: varchar("version_group_id", { length: 128 }).primaryKey(),
  roomId: varchar("room_id", { length: 128 }).notNull(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  triggerMessageId: varchar("trigger_message_id", { length: 128 }).notNull()
    .references(() => roomMessages.messageId, { onDelete: "cascade" }),
  agentMemberId: varchar("agent_member_id", { length: 128 }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("room_agent_reply_version_groups_trigger_agent_unique")
    .on(table.triggerMessageId, table.agentMemberId),
  foreignKey({
    columns: [table.roomId, table.companyId],
    foreignColumns: [rooms.id, rooms.companyId],
    name: "room_agent_reply_version_groups_room_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.companyId, table.agentMemberId],
    foreignColumns: [actors.companyId, actors.id],
    name: "room_agent_reply_version_groups_agent_fk",
  }).onDelete("cascade"),
]);

export const roomAgentReplySelections = pgTable("room_agent_reply_selections", {
  versionGroupId: varchar("version_group_id", { length: 128 }).notNull()
    .references(() => roomAgentReplyVersionGroups.versionGroupId, { onDelete: "cascade" }),
  memberId: varchar("member_id", { length: 128 }).notNull()
    .references(() => actors.id, { onDelete: "cascade" }),
  selectedMessageId: varchar("selected_message_id", { length: 128 }).notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  eventSequence: bigint("event_sequence", { mode: "number" }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.versionGroupId, table.memberId] }),
  foreignKey({
    columns: [table.versionGroupId, table.selectedMessageId],
    foreignColumns: [roomMessages.versionGroupId, roomMessages.messageId],
    name: "room_agent_reply_selections_message_fk",
  }).onDelete("cascade"),
  check("room_agent_reply_selections_revision_check", sql`${table.revision} > 0`),
  check("room_agent_reply_selections_event_sequence_check", sql`${table.eventSequence} > 0`),
]);

export const roomMessageMutationReceipts = pgTable("room_message_mutation_receipts", {
  idempotencyKey: varchar("idempotency_key", { length: 255 }).primaryKey(),
  roomId: varchar("room_id", { length: 128 }).notNull(),
  memberId: varchar("member_id", { length: 128 }).notNull(),
  operation: varchar("operation", { length: 32 }).notNull(),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
  resultJson: jsonb("result_json").notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("room_message_mutation_receipts_room_member_idx")
    .on(table.roomId, table.memberId, table.createdAtMs),
  check(
    "room_message_mutation_receipts_operation_check",
    sql`${table.operation} in ('edit', 'soft_delete', 'regenerate', 'select_version')`,
  ),
]);

/** Exact persisted input set proves that a retry cannot silently skip backlog. */
export const agentRoomExecutionMessages = pgTable("agent_room_execution_messages", {
  executionId: varchar("execution_id", { length: 128 }).notNull(),
  messageId: varchar("message_id", { length: 128 }).notNull(),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.executionId, table.messageId] }),
  uniqueIndex("agent_room_execution_messages_sequence_unique").on(
    table.executionId,
    table.sequence,
  ),
  foreignKey({
    columns: [table.executionId],
    foreignColumns: [agentRoomExecutions.executionId],
    name: "agent_room_execution_messages_execution_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.messageId],
    foreignColumns: [roomMessages.messageId],
    name: "agent_room_execution_messages_message_fk",
  }).onDelete("cascade"),
  check("agent_room_execution_messages_sequence_check", sql`${table.sequence} > 0`),
]);

export const agentRoomActivityReceipts = pgTable("agent_room_activity_receipts", {
  eventId: varchar("event_id", { length: 255 }).primaryKey(),
  executionId: varchar("execution_id", { length: 128 }).notNull()
    .references(() => agentRoomExecutions.executionId, { onDelete: "cascade" }),
  interactionId: varchar("interaction_id", { length: 128 })
    .references((): AnyPgColumn => roomInteractions.interactionId, { onDelete: "set null" }),
  occurredAtMs: bigint("occurred_at_ms", { mode: "number" }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("agent_room_activity_receipts_execution_idx").on(table.executionId, table.createdAtMs),
]);

export const agentRoomActivitySnapshots = pgTable("agent_room_activity_snapshots", {
  executionId: varchar("execution_id", { length: 128 }).notNull()
    .references(() => agentRoomExecutions.executionId, { onDelete: "cascade" }),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  eventId: varchar("event_id", { length: 255 }).notNull(),
  snapshotJson: jsonb("snapshot_json").notNull(),
  occurredAtMs: bigint("occurred_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.executionId, table.sequence] }),
  uniqueIndex("agent_room_activity_snapshots_event_unique").on(table.eventId),
  check("agent_room_activity_snapshots_sequence_check", sql`${table.sequence} > 0`),
]);

export const roomInteractions = pgTable("room_interactions", {
  interactionId: varchar("interaction_id", { length: 128 }).primaryKey(),
  roomId: varchar("room_id", { length: 128 }).notNull(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  executionId: varchar("execution_id", { length: 128 }).notNull()
    .references(() => agentRoomExecutions.executionId, { onDelete: "cascade" }),
  agentMemberId: varchar("agent_member_id", { length: 128 }).notNull(),
  messageId: varchar("message_id", { length: 128 }).notNull()
    .references(() => roomMessages.messageId, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull().default("delegation_check"),
  label: varchar("label", { length: 500 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  responsesJson: jsonb("responses_json").notNull(),
  interactionJson: jsonb("interaction_json"),
  deadlineAtMs: bigint("deadline_at_ms", { mode: "number" }),
  claimToken: varchar("claim_token", { length: 128 }),
  claimedAtMs: bigint("claimed_at_ms", { mode: "number" }),
  resolvedAtMs: bigint("resolved_at_ms", { mode: "number" }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  respondedAtMs: bigint("responded_at_ms", { mode: "number" }),
}, (table) => [
  index("room_interactions_message_idx").on(table.messageId, table.createdAtMs),
  index("room_interactions_execution_idx").on(table.executionId, table.createdAtMs),
  index("room_interactions_due_idx")
    .on(table.deadlineAtMs, table.interactionId)
    .where(sql`${table.status} = 'pending' and ${table.deadlineAtMs} is not null`),
  foreignKey({
    columns: [table.roomId, table.companyId],
    foreignColumns: [rooms.id, rooms.companyId],
    name: "room_interactions_room_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.companyId, table.agentMemberId],
    foreignColumns: [actors.companyId, actors.id],
    name: "room_interactions_agent_fk",
  }).onDelete("cascade"),
  check("room_interactions_kind_check", sql`${table.kind} in ('delegation_check', 'request_user_input')`),
  check("room_interactions_status_check", sql`${table.status} in ('pending', 'responding', 'approved', 'rejected', 'completed')`),
]);

export const roomInteractionResponses = pgTable("room_interaction_responses", {
  persistedResponseId: varchar("persisted_response_id", { length: 128 }).primaryKey(),
  interactionId: varchar("interaction_id", { length: 128 }).notNull()
    .references(() => roomInteractions.interactionId, { onDelete: "cascade" }),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
  clientResponseId: varchar("client_response_id", { length: 128 }),
  responderMemberId: varchar("responder_member_id", { length: 128 }).notNull(),
  response: varchar("response", { length: 32 }).notNull(),
  responseJson: jsonb("response_json"),
  deliveryStatus: varchar("delivery_status", { length: 32 }).notNull().default("pending"),
  runtimeDuplicate: boolean("runtime_duplicate"),
  respondedAtMs: bigint("responded_at_ms", { mode: "number" }).notNull(),
  deliveredAtMs: bigint("delivered_at_ms", { mode: "number" }),
}, (table) => [
  uniqueIndex("room_interaction_responses_idempotency_unique").on(table.idempotencyKey),
  uniqueIndex("room_interaction_responses_client_unique")
    .on(table.interactionId, table.responderMemberId, table.clientResponseId)
    .where(sql`${table.clientResponseId} is not null`),
  check("room_interaction_responses_response_check", sql`${table.response} in ('approve', 'reject', 'answer')`),
  check(
    "room_interaction_responses_delivery_status_check",
    sql`${table.deliveryStatus} in ('pending', 'delivered')`,
  ),
]);
