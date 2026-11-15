import {
  scheduledTaskContentSchema,
  scheduledTaskScheduleSchema,
  type ScheduledTaskBlockedReason,
} from "@fields/contracts/public/scheduled-task";
import { sql } from "drizzle-orm";

import type {
  EventDeadLetterContext,
  EventDeliveryFailure,
  EventHandler,
  EventHandlingContext,
  PersistedEvent,
} from "../../application/eventing/index.js";
import type { CompanyFileApplication } from "../../application/company/ports/company-files.js";
import type { CompanyRuntimePublicGateway } from "../../application/execution/ports/index.js";
import { ApplicationError, isApplicationError } from "../../application/platform/errors.js";
import { markdownToPlainText } from "../../application/room/markdown-to-plain-text.js";
import { nextScheduledTaskRunAt } from "../../application/scheduled-task/index.js";
import type { RoomMessageApplication } from "../../application/room/ports/index.js";
import type { BackendDatabase } from "../persistence/postgres/database-service.js";
import {
  PostgresEventDeadLetterTransaction,
  PostgresEventInboxTransaction,
} from "./postgres/repository.js";
import { emitObservabilityLog } from "../../observability/events.js";

type OccurrencePayload = { company_id: string; task_id: string; run_id: string; requested_at_ms: number };
type DispatchRow = {
  task_id: string; company_id: string; status: string; deleted_at_ms: number | string | bigint | null;
  targetKind: string; home_owner_member_id: string | null; home_thread_mode: string | null; home_thread_id: string | null;
  room_id: string | null; content_json: unknown; schedule_json: unknown;
  run_id: string; run_trigger: string; run_status: string;
};

const FAILURE = {
  room: "SCHEDULED_TASK_ROOM_UNAVAILABLE",
  thread: "SCHEDULED_TASK_HOME_THREAD_UNAVAILABLE",
  references: "SCHEDULED_TASK_REFERENCES_UNAVAILABLE",
  member: "SCHEDULED_TASK_MEMBER_UNAVAILABLE",
  executor: "SCHEDULED_TASK_EXECUTOR_UNAVAILABLE",
} as const;

export class ScheduledTaskOccurrenceHandler implements EventHandler {
  readonly consumerName = "runtime.scheduled-task" as const;

  constructor(
    private readonly db: BackendDatabase,
    private readonly messages: RoomMessageApplication,
    private readonly runtime: CompanyRuntimePublicGateway,
    private readonly companyFiles: CompanyFileApplication,
    private readonly now: () => number = Date.now,
  ) {}

  async handle(event: PersistedEvent, context: EventHandlingContext): Promise<void> {
    const payload = occurrencePayload(event.payload);
    const row = await this.readDispatch(payload);
    const nowMs = this.now();
    await this.db.execute(sql`
      update scheduled_task_runs set status = ${context.attempt > 1 ? "retrying" : "queued"},
        attempt_count = ${context.attempt}, started_at_ms = coalesce(started_at_ms, ${nowMs}), updated_at_ms = ${nowMs}
      where run_id = ${payload.run_id} and status in ('queued', 'retrying')
    `);
    if (context.attempt > 1) {
      emitObservabilityLog("scheduled_tasks.dispatch.retrying", {
        task_id: payload.task_id,
        run_id: payload.run_id,
        attempt: context.attempt,
      });
    }
    if (shouldSkip(row)) {
      await markSkipped(context, payload.run_id, nowMs);
      emitObservabilityLog("scheduled_tasks.dispatch.skipped", { task_id: payload.task_id, run_id: payload.run_id });
      return;
    }
    const content = scheduledTaskContentSchema.parse(jsonFromDb(row.content_json));
    let result: { roomId: string | null; roomMessageId: string | null; homeThreadId: string | null; homeTurnId: string | null };
    try {
      result = row.targetKind === "room"
        ? await this.dispatchRoom(row, content, payload)
        : await this.dispatchHome(row, content, payload);
    } catch (error) {
      throw normalizeDispatchError(error);
    }
    await markSucceeded(context, row, payload.run_id, result, nowMs);
    emitObservabilityLog("scheduled_tasks.dispatch.succeeded", {
      task_id: payload.task_id,
      run_id: payload.run_id,
      targetKind: row.targetKind,
      trigger: row.run_trigger,
    });
  }

  async projectDeadLetter(event: PersistedEvent, failure: EventDeliveryFailure, context: EventDeadLetterContext): Promise<void> {
    const payload = occurrencePayload(event.payload);
    const transaction = requireDeadLetterTransaction(context);
    const reason = blockedReason(failure.code);
    await transaction.execute(sql`
      update scheduled_task_runs set status = 'failed',
        error_reason = ${reason ?? "delivery_failed"}, completed_at_ms = ${context.attemptedAt}, updated_at_ms = ${context.attemptedAt}
      where run_id = ${payload.run_id} and status in ('queued', 'retrying')
    `);
    if (reason) {
      await transaction.execute(sql`
        update scheduled_tasks set status = 'blocked', next_run_at_ms = null,
          blocked_reason = ${reason}, version = version + 1, updated_at_ms = ${context.attemptedAt}
        where task_id = ${payload.task_id} and deleted_at_ms is null and status in ('active', 'paused')
      `);
      emitObservabilityLog("scheduled_tasks.task.blocked", {
        task_id: payload.task_id,
        run_id: payload.run_id,
        reason,
      });
    } else {
      const rows = await transaction.execute<{ schedule_json: unknown; schedule_type: string; status: string }>(sql`
        select schedule_json, schedule_type, status from scheduled_tasks
        where task_id = ${payload.task_id} and deleted_at_ms is null limit 1 for update
      `);
      const task = rows[0];
      if (task?.status === "active") {
        const schedule = scheduledTaskScheduleSchema.parse(jsonFromDb(task.schedule_json));
        const nextRunAtMs = schedule.type === "heartbeat" ? nextScheduledTaskRunAt(schedule, context.attemptedAt) : null;
        if (schedule.type === "heartbeat") {
          await transaction.execute(sql`update scheduled_tasks set next_run_at_ms = ${nextRunAtMs}, updated_at_ms = ${context.attemptedAt} where task_id = ${payload.task_id}`);
        } else if (schedule.type === "once") {
          await transaction.execute(sql`update scheduled_tasks set status = 'completed', next_run_at_ms = null, version = version + 1, updated_at_ms = ${context.attemptedAt} where task_id = ${payload.task_id}`);
        }
      }
    }
    emitObservabilityLog("scheduled_tasks.dispatch.failed", { task_id: payload.task_id, run_id: payload.run_id, reason: reason ?? "delivery_failed" });
  }

  private async readDispatch(payload: OccurrencePayload): Promise<DispatchRow> {
    const rows = rowsFromResult<DispatchRow>(await this.db.execute(sql`
      select task.task_id, task.company_id, task.status, task.deleted_at_ms, task.target_kind as "targetKind",
        task.home_owner_member_id, task.home_thread_mode, task.home_thread_id, task.room_id,
        task.content_json, task.schedule_json, run.run_id, run.trigger as run_trigger, run.status as run_status
      from scheduled_tasks task
      inner join scheduled_task_runs run on run.task_id = task.task_id and run.company_id = task.company_id
      where task.task_id = ${payload.task_id} and task.company_id = ${payload.company_id} and run.run_id = ${payload.run_id}
      limit 2
    `));
    if (rows.length !== 1) throw new ApplicationError(FAILURE.member, false);
    return rows[0]!;
  }

  private async dispatchRoom(row: DispatchRow, content: ReturnType<typeof scheduledTaskContentSchema.parse>, payload: OccurrencePayload) {
    if (content.kind !== "room" || !row.room_id) throw new ApplicationError(FAILURE.references, false);
    const schedulerRows = rowsFromResult<{ scheduler_id: string }>(await this.db.execute(sql`
      select scheduler.id as scheduler_id
      from actors scheduler
      inner join room_memberships membership on membership.actor_id = scheduler.id and membership.company_id = scheduler.company_id
      inner join rooms room on room.id = membership.room_id and room.company_id = membership.company_id
      where scheduler.company_id = ${row.company_id} and scheduler.system_role = 'scheduler' and scheduler.status = 'active'
        and membership.room_id = ${row.room_id} and membership.status = 'active' and room.status = 'active'
        and exists (
          select 1 from room_memberships manager_membership
          inner join actors manager on manager.id = manager_membership.actor_id and manager.company_id = manager_membership.company_id
          where manager_membership.room_id = room.id and manager_membership.status = 'active'
            and manager.type = 'human' and manager.status = 'active' and manager.system_role is null
        ) limit 2
    `));
    if (schedulerRows.length !== 1) throw new ApplicationError(FAILURE.room, false);
    if (content.reply_to_message_ids.length > 0) {
      const ids = [...new Set(content.reply_to_message_ids)];
      const replyRows = rowsFromResult<{ message_id: string }>(await this.db.execute(sql`
        select message_id from room_messages
        where room_id = ${row.room_id} and deleted_at_ms is null
          and message_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `));
      if (replyRows.length !== ids.length) throw new ApplicationError(FAILURE.references, false);
    }
    try {
      await this.companyFiles.validateMessageReferences(row.company_id, row.room_id, content.references);
    } catch (error) {
      if (isApplicationError(error) && !error.retryable) {
        throw new ApplicationError(FAILURE.references, false);
      }
      throw error;
    }
    const sent = await this.messages.send({
      roomId: row.room_id,
      companyId: row.company_id,
      senderMemberId: schedulerRows[0]!.scheduler_id,
      senderType: "human",
      clientMessageId: `scheduled-task:${payload.task_id}:${payload.run_id}`,
      markdown: content.markdown,
      plainText: markdownToPlainText(content.markdown),
      replyToMessageIds: content.reply_to_message_ids,
      references: content.references,
      nowMs: this.now(),
    });
    return { roomId: row.room_id, roomMessageId: sent.message.messageId, homeThreadId: null, homeTurnId: null };
  }

  private async dispatchHome(row: DispatchRow, content: ReturnType<typeof scheduledTaskContentSchema.parse>, payload: OccurrencePayload) {
    if (content.kind !== "home" || !row.home_owner_member_id) throw new ApplicationError(FAILURE.member, false);
    const owners = rowsFromResult<{ id: string }>(await this.db.execute(sql`
      select id from actors where id = ${row.home_owner_member_id} and company_id = ${row.company_id}
        and type = 'human' and status = 'active' and system_role is null limit 2
    `));
    if (owners.length !== 1) throw new ApplicationError(FAILURE.member, false);
    const result = await this.runtime.homeTurnSubmit(row.company_id, row.home_owner_member_id, {
      ...(row.home_thread_mode === "existing" && row.home_thread_id ? { thread_id: row.home_thread_id } : {}),
      prompt: content.prompt,
      client_message_id: `scheduled-task:${payload.task_id}:${payload.run_id}`,
    });
    return { roomId: null, roomMessageId: null, homeThreadId: result.thread_id, homeTurnId: result.turn_id };
  }
}

function occurrencePayload(value: unknown): OccurrencePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApplicationError("SCHEDULED_TASK_EVENT_INVALID", false);
  const row = value as Partial<OccurrencePayload>;
  if (!row.company_id || !row.task_id || !row.run_id || !Number.isSafeInteger(row.requested_at_ms)) throw new ApplicationError("SCHEDULED_TASK_EVENT_INVALID", false);
  return row as OccurrencePayload;
}

function shouldSkip(row: DispatchRow): boolean {
  if (row.run_status === "succeeded" || row.run_status === "failed" || row.run_status === "missed" || row.run_status === "skipped") return true;
  if (row.deleted_at_ms !== null) return true;
  return row.run_trigger === "scheduled" ? row.status !== "active" : row.status !== "active" && row.status !== "paused";
}

async function markSkipped(context: EventHandlingContext, runId: string, nowMs: number): Promise<void> {
  const transaction = requireInboxTransaction(context);
  await transaction.execute(sql`update scheduled_task_runs set status = 'skipped', completed_at_ms = ${nowMs}, updated_at_ms = ${nowMs} where run_id = ${runId} and status in ('queued', 'retrying')`);
}

async function markSucceeded(context: EventHandlingContext, row: DispatchRow, runId: string, result: { roomId: string | null; roomMessageId: string | null; homeThreadId: string | null; homeTurnId: string | null }, nowMs: number): Promise<void> {
  const transaction = requireInboxTransaction(context);
  const updated = await transaction.execute<{ run_id: string }>(sql`
    update scheduled_task_runs set status = 'succeeded', error_reason = null,
      room_id = ${result.roomId}, room_message_id = ${result.roomMessageId},
      home_thread_id = ${result.homeThreadId}, home_turn_id = ${result.homeTurnId},
      completed_at_ms = ${nowMs}, updated_at_ms = ${nowMs}
    where run_id = ${runId} and status in ('queued', 'retrying') returning run_id
  `);
  if (updated.length !== 1 || row.run_trigger !== "scheduled") return;
  const schedule = scheduledTaskScheduleSchema.parse(jsonFromDb(row.schedule_json));
  const heartbeatNext = schedule.type === "heartbeat" ? nextScheduledTaskRunAt(schedule, nowMs) : null;
  await transaction.execute(sql`
    update scheduled_tasks set successful_executions = successful_executions + 1,
      remaining_executions = case when remaining_executions is null then null else greatest(remaining_executions - 1, 0) end,
      status = case when remaining_executions = 1 or ${schedule.type} = 'once' then 'completed' else status end,
      next_run_at_ms = case
        when remaining_executions = 1 or ${schedule.type} = 'once' then null
        when ${schedule.type} = 'heartbeat' and status = 'active' then ${heartbeatNext}
        else next_run_at_ms end,
      version = version + 1, updated_at_ms = ${nowMs}
    where task_id = ${row.task_id} and deleted_at_ms is null
  `);
}

function normalizeDispatchError(error: unknown): ApplicationError {
  if (isApplicationError(error)) {
    if (/HOME_THREAD|THREAD_NOT_FOUND/u.test(error.code)) return new ApplicationError(FAILURE.thread, false);
    if (/EXECUTOR_|MEMBER_EXECUTOR_NOT_FOUND/u.test(error.code) && !error.retryable) return new ApplicationError(FAILURE.executor, false);
    if (/ROOM_MESSAGE_.*(REPLY|REFERENCE|TARGET)/u.test(error.code)) return new ApplicationError(FAILURE.references, false);
    if (/ROOM_MESSAGE_(ACCESS_DENIED|NOT_FOUND)|ROOM_ACCESS/u.test(error.code)) return new ApplicationError(FAILURE.room, false);
    if (/REFERENCE|COMPANY_FILE/u.test(error.code)) return new ApplicationError(FAILURE.references, false);
    return error;
  }
  const diagnostic = dispatchDiagnostic(error);
  if (/HOME THREAD.*(NOT FOUND|DOES NOT EXIST)|HOME_THREAD_NOT_FOUND|THREAD BRANCH DOES NOT EXIST/u.test(diagnostic)) {
    return new ApplicationError(FAILURE.thread, false);
  }
  if (/MEMBER.*(NOT FOUND|UNAVAILABLE)|EXECUTOR.*(NOT FOUND|UNAVAILABLE|REQUIRED|DISCONNECTED)/u.test(diagnostic)) {
    return new ApplicationError(FAILURE.executor, false);
  }
  return new ApplicationError("SCHEDULED_TASK_DELIVERY_FAILED", true);
}

function dispatchDiagnostic(error: unknown): string {
  if (!error || typeof error !== "object") return String(error).toUpperCase();
  const record = error as { message?: unknown; data?: { code?: unknown } };
  return `${typeof record.data?.code === "string" ? record.data.code : ""} ${typeof record.message === "string" ? record.message : ""}`.toUpperCase();
}

function blockedReason(code: string): ScheduledTaskBlockedReason | null {
  if (code === FAILURE.room) return "room_unavailable";
  if (code === FAILURE.thread) return "home_thread_unavailable";
  if (code === FAILURE.references) return "references_unavailable";
  if (code === FAILURE.member) return "member_unavailable";
  if (code === FAILURE.executor) return "executor_unavailable";
  return null;
}

function requireInboxTransaction(context: EventHandlingContext): PostgresEventInboxTransaction {
  if (!(context.inboxTransaction instanceof PostgresEventInboxTransaction)) throw new Error("scheduled_task_inbox_transaction_required");
  return context.inboxTransaction;
}
function requireDeadLetterTransaction(context: EventDeadLetterContext): PostgresEventDeadLetterTransaction {
  if (!(context.transaction instanceof PostgresEventDeadLetterTransaction)) throw new Error("scheduled_task_dead_letter_transaction_required");
  return context.transaction;
}
function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) { const rows = (result as { rows?: unknown }).rows; return Array.isArray(rows) ? rows as T[] : []; }
  return [];
}
function jsonFromDb(value: unknown): unknown { if (typeof value !== "string") return value; try { return JSON.parse(value) as unknown; } catch { return value; } }
