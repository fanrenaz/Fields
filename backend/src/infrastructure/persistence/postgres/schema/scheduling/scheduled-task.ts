import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, jsonb, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { actors } from "../actor.js";
import { companies } from "../company.js";
import { rooms } from "../room.js";

/** Scheduler facts owned by Backend's scheduling boundary. */
export const scheduledTasks = pgTable("scheduled_tasks", {
  taskId: varchar("task_id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull().references(() => companies.id, { onDelete: "cascade" }),
  createdByMemberId: varchar("created_by_member_id", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  targetKind: varchar("target_kind", { length: 16 }).notNull(),
  homeOwnerMemberId: varchar("home_owner_member_id", { length: 128 }),
  homeThreadMode: varchar("home_thread_mode", { length: 32 }),
  homeThreadId: varchar("home_thread_id", { length: 128 }),
  roomId: varchar("room_id", { length: 128 }),
  contentJson: jsonb("content_json").notNull(),
  scheduleType: varchar("schedule_type", { length: 16 }).notNull(),
  scheduleJson: jsonb("schedule_json").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  nextRunAtMs: bigint("next_run_at_ms", { mode: "number" }),
  maxExecutions: bigint("max_executions", { mode: "number" }),
  successfulExecutions: bigint("successful_executions", { mode: "number" }).notNull().default(0),
  remainingExecutions: bigint("remaining_executions", { mode: "number" }),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  blockedReason: varchar("blocked_reason", { length: 64 }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  deletedAtMs: bigint("deleted_at_ms", { mode: "number" }),
}, (table) => [
  index("scheduled_tasks_company_list_idx").on(table.companyId, table.status, table.updatedAtMs),
  index("scheduled_tasks_due_idx").on(table.nextRunAtMs, table.taskId).where(sql`${table.status} = 'active' and ${table.deletedAtMs} is null`),
  foreignKey({
    name: "scheduled_tasks_creator_actor_fk",
    columns: [table.companyId, table.createdByMemberId],
    foreignColumns: [actors.companyId, actors.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "scheduled_tasks_home_owner_actor_fk",
    columns: [table.companyId, table.homeOwnerMemberId],
    foreignColumns: [actors.companyId, actors.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "scheduled_tasks_room_fk",
    columns: [table.roomId, table.companyId],
    foreignColumns: [rooms.id, rooms.companyId],
  }).onDelete("restrict"),
  check("scheduled_tasks_target_kind_check", sql`${table.targetKind} in ('home', 'room')`),
  check("scheduled_tasks_target_shape_check", sql`(
    ${table.targetKind} = 'home' and ${table.homeOwnerMemberId} is not null
      and ${table.homeThreadMode} in ('existing', 'new_each_run') and ${table.roomId} is null
      and ((${table.homeThreadMode} = 'existing') = (${table.homeThreadId} is not null))
  ) or (
    ${table.targetKind} = 'room' and ${table.roomId} is not null
      and ${table.homeOwnerMemberId} is null and ${table.homeThreadMode} is null and ${table.homeThreadId} is null
  )`),
  check("scheduled_tasks_schedule_type_check", sql`${table.scheduleType} in ('once', 'cron', 'heartbeat')`),
  check("scheduled_tasks_status_check", sql`${table.status} in ('active', 'paused', 'blocked', 'completed')`),
  check("scheduled_tasks_execution_counts_check", sql`
    ${table.successfulExecutions} >= 0
    and (${table.maxExecutions} is null or ${table.maxExecutions} > 0)
    and (${table.remainingExecutions} is null or ${table.remainingExecutions} >= 0)
  `),
  check("scheduled_tasks_version_check", sql`${table.version} > 0`),
]);

export const scheduledTaskRuns = pgTable("scheduled_task_runs", {
  runId: varchar("run_id", { length: 128 }).primaryKey(),
  taskId: varchar("task_id", { length: 128 }).notNull().references(() => scheduledTasks.taskId, { onDelete: "cascade" }),
  companyId: varchar("company_id", { length: 128 }).notNull().references(() => companies.id, { onDelete: "cascade" }),
  trigger: varchar("trigger", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("queued"),
  occurrenceKey: varchar("occurrence_key", { length: 255 }).notNull(),
  eventId: varchar("event_id", { length: 128 }),
  scheduledForMs: bigint("scheduled_for_ms", { mode: "number" }),
  startedAtMs: bigint("started_at_ms", { mode: "number" }),
  completedAtMs: bigint("completed_at_ms", { mode: "number" }),
  attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
  errorReason: varchar("error_reason", { length: 64 }),
  roomId: varchar("room_id", { length: 128 }),
  roomMessageId: varchar("room_message_id", { length: 128 }),
  homeThreadId: varchar("home_thread_id", { length: 128 }),
  homeTurnId: varchar("home_turn_id", { length: 128 }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("scheduled_task_runs_occurrence_unique").on(table.taskId, table.occurrenceKey),
  uniqueIndex("scheduled_task_runs_event_unique").on(table.eventId),
  index("scheduled_task_runs_task_history_idx").on(table.taskId, table.createdAtMs.desc()),
  index("scheduled_task_runs_retention_idx").on(table.completedAtMs),
  check("scheduled_task_runs_trigger_check", sql`${table.trigger} in ('scheduled', 'run_now')`),
  check("scheduled_task_runs_status_check", sql`${table.status} in ('queued', 'retrying', 'succeeded', 'failed', 'missed', 'skipped')`),
  check("scheduled_task_runs_attempt_check", sql`${table.attemptCount} >= 0`),
]);

export const scheduledTaskMutationReceipts = pgTable("scheduled_task_mutation_receipts", {
  companyId: varchar("company_id", { length: 128 }).notNull().references(() => companies.id, { onDelete: "cascade" }),
  actorId: varchar("actor_id", { length: 128 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
  operation: varchar("operation", { length: 32 }).notNull(),
  requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
  taskId: varchar("task_id", { length: 128 }).notNull().references(() => scheduledTasks.taskId, { onDelete: "cascade" }),
  responseJson: jsonb("response_json").notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("scheduled_task_mutation_receipts_key_unique").on(table.companyId, table.actorId, table.idempotencyKey),
  index("scheduled_task_mutation_receipts_task_idx").on(table.taskId),
]);
