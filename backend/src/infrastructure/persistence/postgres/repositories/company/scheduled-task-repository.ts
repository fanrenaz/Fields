import { createHash, randomUUID } from "node:crypto";

import {
  scheduledTaskContentSchema,
  scheduledTaskRunSummarySchema,
  scheduledTaskScheduleSchema,
  scheduledTaskSummarySchema,
  type ScheduledTaskCreateInput,
  type ScheduledTaskListResult,
  type ScheduledTaskRunsListResult,
  type ScheduledTaskSummary,
  type ScheduledTaskUpdateInput,
  type ScheduledTaskVersionMutationInput,
} from "@fields/contracts/public/scheduled-task";
import { sql } from "drizzle-orm";

import {
  nextScheduledTaskRunAt,
  validateScheduledTaskSchedule,
  type ScheduledTaskApplication,
} from "../../../../../application/scheduled-task/index.js";
import type { CompanyFileApplication } from "../../../../../application/company/ports/company-files.js";
import type { CompanyRuntimePublicGateway } from "../../../../../application/execution/ports/index.js";
import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";

export const SCHEDULED_TASK_NOT_FOUND_CODE = "SCHEDULED_TASK_NOT_FOUND";
export const SCHEDULED_TASK_ACCESS_DENIED_CODE = "SCHEDULED_TASK_ACCESS_DENIED";
export const SCHEDULED_TASK_CONFLICT_CODE = "SCHEDULED_TASK_CONFLICT";
export const SCHEDULED_TASK_INVALID_CODE = "SCHEDULED_TASK_INVALID";
export const SCHEDULED_TASK_TARGET_INVALID_CODE = "SCHEDULED_TASK_TARGET_INVALID";

type DatabaseExecutor = Pick<BackendDatabase, "execute">;
type DatabaseNumber = number | string | bigint;
type TaskRow = {
  task_id: string; company_id: string; created_by_member_id: string; name: string; targetKind: string;
  home_owner_member_id: string | null; home_thread_mode: string | null; home_thread_id: string | null;
  room_id: string | null; content_json: unknown; schedule_json: unknown; schedule_type: string; status: string;
  next_run_at_ms: DatabaseNumber | null; max_executions: DatabaseNumber | null;
  successful_executions: DatabaseNumber; remaining_executions: DatabaseNumber | null; version: DatabaseNumber;
  blocked_reason: string | null; created_at_ms: DatabaseNumber; updated_at_ms: DatabaseNumber; deleted_at_ms: DatabaseNumber | null;
};
type RunRow = {
  run_id: string; task_id: string; trigger: string; status: string; scheduled_for_ms: DatabaseNumber | null;
  started_at_ms: DatabaseNumber | null; completed_at_ms: DatabaseNumber | null; attempt_count: DatabaseNumber;
  error_reason: string | null; room_id: string | null; room_message_id: string | null;
  home_thread_id: string | null; home_turn_id: string | null; created_at_ms: DatabaseNumber;
};
type ReceiptRow = { operation: string; request_fingerprint: string; response_json: unknown };

export type ScheduledTaskApplicationDependencies = {
  runtime: CompanyRuntimePublicGateway;
  companyFiles: CompanyFileApplication;
  now?: () => number;
};

export class PostgresScheduledTaskApplication implements ScheduledTaskApplication {
  readonly #now: () => number;

  constructor(private readonly db: BackendDatabase, private readonly dependencies: ScheduledTaskApplicationDependencies) {
    this.#now = dependencies.now ?? Date.now;
  }

  async list(companyId: string, actorId: string): Promise<ScheduledTaskListResult> {
    const rows = rowsFromResult<TaskRow>(await this.db.execute(sql`
      select ${taskColumns("task")} from scheduled_tasks task
      where task.company_id = ${companyId} and task.deleted_at_ms is null
        and ${taskAccessSql("task", actorId)}
      order by task.updated_at_ms desc, task.task_id asc
    `));
    return { items: rows.map(taskFromRow) };
  }

  async get(companyId: string, actorId: string, taskId: string): Promise<ScheduledTaskSummary> {
    return taskFromRow(await this.requireTask(this.db, companyId, actorId, taskId));
  }

  async create(companyId: string, actorId: string, input: ScheduledTaskCreateInput): Promise<ScheduledTaskSummary> {
    await this.validateTarget(companyId, actorId, input);
    validateScheduledTaskSchedule(input.schedule);
    const nowMs = this.#now();
    const maxExecutions = input.schedule.type === "once" ? 1 : input.max_executions;
    const nextRunAtMs = nextScheduledTaskRunAt(input.schedule, nowMs);
    if (nextRunAtMs === null) throw invalid();
    const operation = "create";
    const fingerprint = requestFingerprint(operation, input);
    return this.db.transaction(async (transaction) => {
      const replay = await receipt(transaction, companyId, actorId, input.idempotency_key, operation, fingerprint);
      if (replay) return replay;
      await requireActiveOrdinaryHuman(transaction, companyId, actorId);
      if (input.target.kind === "room") {
        await requireRoomManager(transaction, companyId, actorId, input.target.room_id);
        await validateRoomReplyTargets(transaction, input.target.room_id, input.content.kind === "room" ? input.content.reply_to_message_ids : []);
      }
      const taskId = `scheduled_task_${randomUUID()}`;
      const target = input.target.kind === "home"
        ? { owner: actorId, mode: input.target.thread_mode, thread: input.target.thread_id, room: null }
        : { owner: null, mode: null, thread: null, room: input.target.room_id };
      const rows = rowsFromResult<TaskRow>(await transaction.execute(sql`
        insert into scheduled_tasks (
          task_id, company_id, created_by_member_id, name, target_kind,
          home_owner_member_id, home_thread_mode, home_thread_id, room_id,
          content_json, schedule_type, schedule_json, status, next_run_at_ms,
          max_executions, successful_executions, remaining_executions,
          version, blocked_reason, created_at_ms, updated_at_ms, deleted_at_ms
        ) values (
          ${taskId}, ${companyId}, ${actorId}, ${taskName(input.name, input.content)}, ${input.target.kind},
          ${target.owner}, ${target.mode}, ${target.thread}, ${target.room},
          ${JSON.stringify(input.content)}::jsonb, ${input.schedule.type}, ${JSON.stringify(input.schedule)}::jsonb,
          'active', ${nextRunAtMs}, ${maxExecutions}, 0, ${maxExecutions}, 1, null, ${nowMs}, ${nowMs}, null
        ) returning ${taskColumns()}
      `));
      const task = taskFromSingleRow(rows);
      await storeReceipt(transaction, companyId, actorId, input.idempotency_key, operation, fingerprint, task, nowMs);
      return task;
    });
  }

  async update(companyId: string, actorId: string, input: ScheduledTaskUpdateInput): Promise<ScheduledTaskSummary> {
    validateScheduledTaskSchedule(input.schedule);
    const nowMs = this.#now();
    const operation = "update";
    const fingerprint = requestFingerprint(operation, input);
    return this.db.transaction(async (transaction) => {
      const replay = await receipt(transaction, companyId, actorId, input.idempotency_key, operation, fingerprint);
      if (replay) return replay;
      const current = await this.requireTask(transaction, companyId, actorId, input.task_id, true);
      if (current.targetKind !== input.content.kind) throw invalid();
      if (current.targetKind === "room") {
        await this.dependencies.companyFiles.validateMessageReferences(companyId, current.room_id!, input.content.kind === "room" ? input.content.references : []);
        await validateRoomReplyTargets(transaction, current.room_id!, input.content.kind === "room" ? input.content.reply_to_message_ids : []);
      }
      const maxExecutions = input.schedule.type === "once" ? 1 : input.max_executions;
      const nextRunAtMs = current.status === "active" ? nextScheduledTaskRunAt(input.schedule, nowMs) : null;
      const status = current.status === "active" && nextRunAtMs === null ? "completed" : current.status;
      const rows = rowsFromResult<TaskRow>(await transaction.execute(sql`
        update scheduled_tasks set name = ${input.name}, content_json = ${JSON.stringify(input.content)}::jsonb,
          schedule_type = ${input.schedule.type}, schedule_json = ${JSON.stringify(input.schedule)}::jsonb,
          max_executions = ${maxExecutions}, remaining_executions = ${maxExecutions}, status = ${status},
          next_run_at_ms = ${nextRunAtMs}, version = version + 1, updated_at_ms = ${nowMs}
        where task_id = ${input.task_id} and version = ${input.expected_version} and deleted_at_ms is null
        returning ${taskColumns()}
      `));
      const task = taskFromVersionedRows(rows);
      await storeReceipt(transaction, companyId, actorId, input.idempotency_key, operation, fingerprint, task, nowMs);
      return task;
    });
  }

  pause(companyId: string, actorId: string, input: ScheduledTaskVersionMutationInput): Promise<ScheduledTaskSummary> {
    return this.transition(companyId, actorId, input, "pause");
  }
  resume(companyId: string, actorId: string, input: ScheduledTaskVersionMutationInput): Promise<ScheduledTaskSummary> {
    return this.transition(companyId, actorId, input, "resume");
  }

  async runNow(companyId: string, actorId: string, input: ScheduledTaskVersionMutationInput): Promise<ScheduledTaskSummary> {
    const nowMs = this.#now();
    const operation = "run_now";
    const fingerprint = requestFingerprint(operation, input);
    return this.db.transaction(async (transaction) => {
      const replay = await receipt(transaction, companyId, actorId, input.idempotency_key, operation, fingerprint);
      if (replay) return replay;
      const current = await this.requireTask(transaction, companyId, actorId, input.task_id, true);
      if (numberFromDb(current.version) !== input.expected_version) throw conflict();
      if (current.status !== "active" && current.status !== "paused") throw invalid();
      const runId = `scheduled_run_${randomUUID()}`;
      await insertRunAndEvent(transaction, {
        companyId, taskId: input.task_id, runId, eventId: `scheduled:${randomUUID()}`,
        occurrenceKey: `run_now:${input.idempotency_key}`, scheduledForMs: null, nowMs, trigger: "run_now",
      });
      const task = taskFromRow(current);
      await storeReceipt(transaction, companyId, actorId, input.idempotency_key, operation, fingerprint, task, nowMs);
      return task;
    });
  }

  async softDelete(companyId: string, actorId: string, input: ScheduledTaskVersionMutationInput): Promise<{ task_id: string; deleted: true }> {
    const nowMs = this.#now();
    const operation = "soft_delete";
    const fingerprint = requestFingerprint(operation, input);
    return this.db.transaction(async (transaction) => {
      const existing = await rawReceipt(transaction, companyId, actorId, input.idempotency_key);
      if (existing) {
        validateReceipt(existing, operation, fingerprint);
        return { task_id: input.task_id, deleted: true as const };
      }
      await this.requireTask(transaction, companyId, actorId, input.task_id, true);
      const rows = rowsFromResult<{ task_id: string }>(await transaction.execute(sql`
        update scheduled_tasks set deleted_at_ms = ${nowMs}, next_run_at_ms = null,
          version = version + 1, updated_at_ms = ${nowMs}
        where task_id = ${input.task_id} and version = ${input.expected_version} and deleted_at_ms is null
        returning task_id
      `));
      if (rows.length !== 1) throw conflict();
      const response = { task_id: input.task_id, deleted: true as const };
      await storeRawReceipt(transaction, companyId, actorId, input.idempotency_key, operation, fingerprint, input.task_id, response, nowMs);
      return response;
    });
  }

  async listRuns(companyId: string, actorId: string, taskId: string, cursor: string | null, limit: number): Promise<ScheduledTaskRunsListResult> {
    await this.requireTask(this.db, companyId, actorId, taskId);
    const cursorClause = cursor ? sql`and (run.created_at_ms, run.run_id) < (
      select cursor_run.created_at_ms, cursor_run.run_id from scheduled_task_runs cursor_run
      where cursor_run.run_id = ${cursor} and cursor_run.task_id = ${taskId}
        and cursor_run.company_id = ${companyId}
    )` : sql.empty();
    const rows = rowsFromResult<RunRow>(await this.db.execute(sql`
      select run_id, task_id, trigger, status, scheduled_for_ms, started_at_ms, completed_at_ms,
        attempt_count, error_reason, room_id, room_message_id, home_thread_id, home_turn_id, created_at_ms
      from scheduled_task_runs run where run.task_id = ${taskId} and run.company_id = ${companyId} ${cursorClause}
      order by run.created_at_ms desc, run.run_id desc limit ${limit + 1}
    `));
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(runFromRow);
    return { items, page: { next_cursor: hasMore ? items.at(-1)?.run_id ?? null : null } };
  }

  private async transition(companyId: string, actorId: string, input: ScheduledTaskVersionMutationInput, operation: "pause" | "resume"): Promise<ScheduledTaskSummary> {
    const nowMs = this.#now();
    const fingerprint = requestFingerprint(operation, input);
    return this.db.transaction(async (transaction) => {
      const replay = await receipt(transaction, companyId, actorId, input.idempotency_key, operation, fingerprint);
      if (replay) return replay;
      const current = await this.requireTask(transaction, companyId, actorId, input.task_id, true);
      if (numberFromDb(current.version) !== input.expected_version) throw conflict();
      const schedule = scheduledTaskScheduleSchema.parse(current.schedule_json);
      if (operation === "pause" && current.status !== "active") throw invalid();
      if (operation === "resume" && current.status !== "paused" && current.status !== "blocked") throw invalid();
      const nextRunAtMs = operation === "resume" ? nextScheduledTaskRunAt(schedule, nowMs) : null;
      const status = operation === "pause" ? "paused" : nextRunAtMs === null ? "completed" : "active";
      const rows = rowsFromResult<TaskRow>(await transaction.execute(sql`
        update scheduled_tasks set status = ${status}, next_run_at_ms = ${nextRunAtMs}, blocked_reason = null,
          version = version + 1, updated_at_ms = ${nowMs}
        where task_id = ${input.task_id} and version = ${input.expected_version} and deleted_at_ms is null
        returning ${taskColumns()}
      `));
      const task = taskFromVersionedRows(rows);
      await storeReceipt(transaction, companyId, actorId, input.idempotency_key, operation, fingerprint, task, nowMs);
      return task;
    });
  }

  private async validateTarget(companyId: string, actorId: string, input: ScheduledTaskCreateInput): Promise<void> {
    if (input.target.kind === "home") {
      if (input.target.thread_mode === "existing" && input.target.thread_id) {
        try { await this.dependencies.runtime.homeThreadRead(companyId, actorId, { thread_id: input.target.thread_id }); }
        catch { throw targetInvalid(); }
      }
      return;
    }
    if (input.content.kind !== "room") throw invalid();
    try { await this.dependencies.companyFiles.validateMessageReferences(companyId, input.target.room_id, input.content.references); }
    catch { throw targetInvalid(); }
  }

  private async requireTask(database: DatabaseExecutor, companyId: string, actorId: string, taskId: string, lock = false): Promise<TaskRow> {
    const lockClause = lock ? sql`for update of task` : sql.empty();
    const rows = rowsFromResult<TaskRow>(await database.execute(sql`
      select ${taskColumns("task")} from scheduled_tasks task
      where task.task_id = ${taskId} and task.company_id = ${companyId}
        and task.deleted_at_ms is null and ${taskAccessSql("task", actorId)}
      limit 2 ${lockClause}
    `));
    if (rows.length !== 1) throw notFound();
    return rows[0]!;
  }
}

async function requireActiveOrdinaryHuman(database: DatabaseExecutor, companyId: string, actorId: string): Promise<void> {
  const rows = rowsFromResult<{ id: string }>(await database.execute(sql`
    select id from actors where company_id = ${companyId} and id = ${actorId}
      and type = 'human' and status = 'active' and system_role is null limit 2
  `));
  if (rows.length !== 1) throw new ApplicationError(SCHEDULED_TASK_ACCESS_DENIED_CODE, false);
}

async function requireRoomManager(database: DatabaseExecutor, companyId: string, actorId: string, roomId: string): Promise<void> {
  const rows = rowsFromResult<{ room_id: string }>(await database.execute(sql`
    select room.id as room_id from rooms room
    inner join room_memberships membership on membership.room_id = room.id and membership.company_id = room.company_id
    inner join actors actor on actor.id = membership.actor_id and actor.company_id = membership.company_id
    where room.id = ${roomId} and room.company_id = ${companyId} and room.status = 'active'
      and membership.actor_id = ${actorId} and membership.status = 'active'
      and actor.type = 'human' and actor.status = 'active' and actor.system_role is null limit 2
  `));
  if (rows.length !== 1) throw targetInvalid();
}

async function validateRoomReplyTargets(database: DatabaseExecutor, roomId: string, messageIds: readonly string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const uniqueIds = [...new Set(messageIds)];
  const values = sql.join(uniqueIds.map((id) => sql`${id}`), sql`, `);
  const rows = rowsFromResult<{ message_id: string }>(await database.execute(sql`
    select message_id from room_messages where room_id = ${roomId}
      and message_id in (${values}) and deleted_at_ms is null
  `));
  if (rows.length !== uniqueIds.length) throw targetInvalid();
}

function taskAccessSql(alias: string, actorId: string) {
  const task = sql.identifier(alias);
  return sql`(
    (${task}.target_kind = 'home' and ${task}.created_by_member_id = ${actorId})
    or (${task}.target_kind = 'room' and exists (
      select 1 from room_memberships membership
      inner join actors requester on requester.id = membership.actor_id and requester.company_id = membership.company_id
      where membership.room_id = ${task}.room_id and membership.company_id = ${task}.company_id
        and membership.actor_id = ${actorId} and membership.status = 'active'
        and requester.type = 'human' and requester.status = 'active' and requester.system_role is null
    ))
  )`;
}

function taskColumns(alias?: string) {
  const prefix = alias ? sql`${sql.identifier(alias)}.` : sql.empty();
  return sql`${prefix}task_id, ${prefix}company_id, ${prefix}created_by_member_id, ${prefix}name,
    ${prefix}target_kind as "targetKind", ${prefix}home_owner_member_id, ${prefix}home_thread_mode, ${prefix}home_thread_id,
    ${prefix}room_id, ${prefix}content_json, ${prefix}schedule_type, ${prefix}schedule_json,
    ${prefix}status, ${prefix}next_run_at_ms, ${prefix}max_executions, ${prefix}successful_executions,
    ${prefix}remaining_executions, ${prefix}version, ${prefix}blocked_reason,
    ${prefix}created_at_ms, ${prefix}updated_at_ms, ${prefix}deleted_at_ms`;
}

function taskFromSingleRow(rows: TaskRow[]): ScheduledTaskSummary { if (rows.length !== 1) throw conflict(); return taskFromRow(rows[0]!); }
function taskFromVersionedRows(rows: TaskRow[]): ScheduledTaskSummary { if (rows.length !== 1) throw conflict(); return taskFromRow(rows[0]!); }

export function taskFromRow(row: TaskRow): ScheduledTaskSummary {
  const target = row.targetKind === "home"
    ? { kind: "home" as const, owner_member_id: requiredString(row.home_owner_member_id), thread_mode: row.home_thread_mode, thread_id: row.home_thread_id }
    : { kind: "room" as const, room_id: requiredString(row.room_id) };
  return scheduledTaskSummarySchema.parse({
    task_id: row.task_id, company_id: row.company_id, created_by_member_id: row.created_by_member_id,
    name: row.name, target, content: scheduledTaskContentSchema.parse(jsonFromDb(row.content_json)),
    schedule: scheduledTaskScheduleSchema.parse(jsonFromDb(row.schedule_json)), status: row.status,
    next_run_at_ms: nullableNumber(row.next_run_at_ms), max_executions: nullableNumber(row.max_executions),
    successful_executions: numberFromDb(row.successful_executions), remaining_executions: nullableNumber(row.remaining_executions),
    version: numberFromDb(row.version), blocked_reason: row.blocked_reason,
    created_at_ms: numberFromDb(row.created_at_ms), updated_at_ms: numberFromDb(row.updated_at_ms),
  });
}

function runFromRow(row: RunRow) {
  return scheduledTaskRunSummarySchema.parse({
    run_id: row.run_id, task_id: row.task_id, trigger: row.trigger, status: row.status,
    scheduled_for_ms: nullableNumber(row.scheduled_for_ms), started_at_ms: nullableNumber(row.started_at_ms),
    completed_at_ms: nullableNumber(row.completed_at_ms), attempt_count: numberFromDb(row.attempt_count),
    error_reason: row.error_reason, room_id: row.room_id, room_message_id: row.room_message_id,
    home_thread_id: row.home_thread_id, home_turn_id: row.home_turn_id, created_at_ms: numberFromDb(row.created_at_ms),
  });
}

export async function insertRunAndEvent(database: DatabaseExecutor, input: {
  companyId: string; taskId: string; runId: string; eventId: string; occurrenceKey: string;
  scheduledForMs: number | null; nowMs: number; trigger: "scheduled" | "run_now";
}): Promise<boolean> {
  const inserted = rowsFromResult<{ run_id: string }>(await database.execute(sql`
    insert into scheduled_task_runs (
      run_id, task_id, company_id, trigger, status, occurrence_key, event_id,
      scheduled_for_ms, attempt_count, created_at_ms, updated_at_ms
    ) values (
      ${input.runId}, ${input.taskId}, ${input.companyId}, ${input.trigger}, 'queued',
      ${input.occurrenceKey}, ${input.eventId}, ${input.scheduledForMs}, 0, ${input.nowMs}, ${input.nowMs}
    ) on conflict (task_id, occurrence_key) do nothing returning run_id
  `));
  if (inserted.length === 0) return false;
  if (inserted.length !== 1) throw conflict();
  await database.execute(sql`
    insert into outbox_events (event_id, event_type, schema_version, aggregate_type, aggregate_id, payload_json, occurred_at_ms, dispatched_at_ms)
    values (
      ${input.eventId}, 'scheduled_task.occurrence_requested.v1', 1, 'scheduled_task', ${input.taskId},
      ${JSON.stringify({ company_id: input.companyId, run_id: input.runId, task_id: input.taskId, requested_at_ms: input.nowMs })}::jsonb,
      ${input.nowMs}, null
    ) on conflict (event_id) do nothing
  `);
  return true;
}

async function receipt(database: DatabaseExecutor, companyId: string, actorId: string, key: string, operation: string, fingerprint: string): Promise<ScheduledTaskSummary | null> {
  const existing = await rawReceipt(database, companyId, actorId, key);
  if (!existing) return null;
  validateReceipt(existing, operation, fingerprint);
  return scheduledTaskSummarySchema.parse(jsonFromDb(existing.response_json));
}
async function rawReceipt(database: DatabaseExecutor, companyId: string, actorId: string, key: string): Promise<ReceiptRow | null> {
  const rows = rowsFromResult<ReceiptRow>(await database.execute(sql`
    select operation, request_fingerprint, response_json from scheduled_task_mutation_receipts
    where company_id = ${companyId} and actor_id = ${actorId} and idempotency_key = ${key} limit 2
  `));
  if (rows.length > 1) throw conflict();
  return rows[0] ?? null;
}
function validateReceipt(row: ReceiptRow, operation: string, fingerprint: string): void {
  if (row.operation !== operation || row.request_fingerprint !== fingerprint) throw conflict();
}
async function storeReceipt(database: DatabaseExecutor, companyId: string, actorId: string, key: string, operation: string, fingerprint: string, task: ScheduledTaskSummary, nowMs: number): Promise<void> {
  await storeRawReceipt(database, companyId, actorId, key, operation, fingerprint, task.task_id, task, nowMs);
}
async function storeRawReceipt(database: DatabaseExecutor, companyId: string, actorId: string, key: string, operation: string, fingerprint: string, taskId: string, response: unknown, nowMs: number): Promise<void> {
  await database.execute(sql`
    insert into scheduled_task_mutation_receipts (
      company_id, actor_id, idempotency_key, operation, request_fingerprint, task_id, response_json, created_at_ms
    ) values (${companyId}, ${actorId}, ${key}, ${operation}, ${fingerprint}, ${taskId}, ${JSON.stringify(response)}::jsonb, ${nowMs})
  `);
}

function taskName(value: string | undefined, content: ScheduledTaskCreateInput["content"]): string {
  if (value?.trim()) return value.trim();
  const message = content.kind === "home" ? content.prompt : content.markdown;
  return message.split(/\r?\n/u).map((line) => line.trim()).find(Boolean)?.slice(0, 255) || "Scheduled task";
}
function requestFingerprint(operation: string, value: unknown): string { return createHash("sha256").update(`${operation}\n${JSON.stringify(value)}`).digest("hex"); }
function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }
  return [];
}
function jsonFromDb(value: unknown): unknown { if (typeof value !== "string") return value; try { return JSON.parse(value) as unknown; } catch { return value; } }
function numberFromDb(value: DatabaseNumber): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw invalid(); return parsed; }
function nullableNumber(value: DatabaseNumber | null): number | null { return value === null ? null : numberFromDb(value); }
function requiredString(value: string | null): string { if (!value) throw invalid(); return value; }
function notFound(): ApplicationError { return new ApplicationError(SCHEDULED_TASK_NOT_FOUND_CODE, false); }
function targetInvalid(): ApplicationError { return new ApplicationError(SCHEDULED_TASK_TARGET_INVALID_CODE, false); }
function conflict(): ApplicationError { return new ApplicationError(SCHEDULED_TASK_CONFLICT_CODE, false); }
function invalid(): ApplicationError { return new ApplicationError(SCHEDULED_TASK_INVALID_CODE, false); }
