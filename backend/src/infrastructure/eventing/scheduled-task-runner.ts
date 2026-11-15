import { randomUUID } from "node:crypto";

import { scheduledTaskScheduleSchema } from "@fields/contracts/public/scheduled-task";
import { sql } from "drizzle-orm";

import { nextScheduledTaskRunAt } from "../../application/scheduled-task/index.js";
import type { BackendDatabase } from "../persistence/postgres/database-service.js";
import { insertRunAndEvent } from "../persistence/postgres/repositories/company/scheduled-task-repository.js";
import { emitObservabilityLog } from "../../observability/events.js";

const SCAN_INTERVAL_MS = 1_000;
const CLAIM_LIMIT = 100;
const MISSED_GRACE_MS = 60_000;
const RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

type DueRow = {
  task_id: string;
  company_id: string;
  schedule_json: unknown;
  next_run_at_ms: number | string | bigint;
};

export type ScheduledTaskTickResult = {
  scanned: boolean;
  claimed: number;
  queued: number;
  missed: number;
  cleaned: number;
  maxDelayMs: number;
};

export class PostgresScheduledTaskRunner {
  #lastScanAtMs = 0;
  #lastCleanupAtMs = 0;

  constructor(private readonly db: BackendDatabase, private readonly now: () => number = Date.now) {}

  async runTick(): Promise<ScheduledTaskTickResult> {
    const nowMs = this.now();
    if (nowMs - this.#lastScanAtMs < SCAN_INTERVAL_MS) {
      return { scanned: false, claimed: 0, queued: 0, missed: 0, cleaned: 0, maxDelayMs: 0 };
    }
    this.#lastScanAtMs = nowMs;
    const claimed = await this.claimDue(nowMs);
    const cleaned = nowMs - this.#lastCleanupAtMs >= CLEANUP_INTERVAL_MS
      ? await this.cleanup(nowMs)
      : 0;
    if (nowMs - this.#lastCleanupAtMs >= CLEANUP_INTERVAL_MS) this.#lastCleanupAtMs = nowMs;
    emitObservabilityLog("scheduled_tasks.scan.completed", {
      claimed: claimed.claimed,
      queued: claimed.queued,
      missed: claimed.missed,
      cleaned,
      max_delay_ms: claimed.maxDelayMs,
    });
    return { scanned: true, ...claimed, cleaned };
  }

  private async claimDue(nowMs: number): Promise<Omit<ScheduledTaskTickResult, "scanned" | "cleaned">> {
    return this.db.transaction(async (transaction) => {
      const rows = rowsFromResult<DueRow>(await transaction.execute(sql`
        select task_id, company_id, schedule_json, next_run_at_ms
        from scheduled_tasks
        where status = 'active' and deleted_at_ms is null
          and next_run_at_ms is not null and next_run_at_ms <= ${nowMs}
        order by next_run_at_ms asc, task_id asc
        for update skip locked
        limit ${CLAIM_LIMIT}
      `));
      let queued = 0;
      let missed = 0;
      let maxDelayMs = 0;
      for (const row of rows) {
        const scheduledForMs = numberFromDb(row.next_run_at_ms);
        const delayMs = Math.max(0, nowMs - scheduledForMs);
        maxDelayMs = Math.max(maxDelayMs, delayMs);
        const schedule = scheduledTaskScheduleSchema.parse(jsonFromDb(row.schedule_json));
        if (delayMs > MISSED_GRACE_MS) {
          const runId = `scheduled_run_${randomUUID()}`;
          await transaction.execute(sql`
            insert into scheduled_task_runs (
              run_id, task_id, company_id, trigger, status, occurrence_key,
              scheduled_for_ms, attempt_count, completed_at_ms, created_at_ms, updated_at_ms
            ) values (
              ${runId}, ${row.task_id}, ${row.company_id}, 'scheduled', 'missed',
              ${`scheduled:${scheduledForMs}`}, ${scheduledForMs}, 0, ${nowMs}, ${nowMs}, ${nowMs}
            ) on conflict (task_id, occurrence_key) do nothing
          `);
          const nextRunAtMs = schedule.type === "once" ? null : nextScheduledTaskRunAt(schedule, nowMs);
          await transaction.execute(sql`
            update scheduled_tasks
            set status = ${schedule.type === "once" ? "completed" : "active"},
              next_run_at_ms = ${nextRunAtMs}, version = version + 1, updated_at_ms = ${nowMs}
            where task_id = ${row.task_id}
          `);
          emitObservabilityLog("scheduled_tasks.occurrence.missed", {
            task_id: row.task_id,
            delay_ms: delayMs,
            schedule_type: schedule.type,
          });
          missed += 1;
          continue;
        }
        const runId = `scheduled_run_${randomUUID()}`;
        const inserted = await insertRunAndEvent(transaction, {
          companyId: row.company_id,
          taskId: row.task_id,
          runId,
          eventId: `scheduled:${randomUUID()}`,
          occurrenceKey: `scheduled:${scheduledForMs}`,
          scheduledForMs,
          nowMs,
          trigger: "scheduled",
        });
        const nextRunAtMs = schedule.type === "cron"
          ? nextScheduledTaskRunAt(schedule, scheduledForMs)
          : null;
        await transaction.execute(sql`
          update scheduled_tasks set next_run_at_ms = ${nextRunAtMs}, updated_at_ms = ${nowMs}
          where task_id = ${row.task_id}
        `);
        if (inserted) {
          emitObservabilityLog("scheduled_tasks.occurrence.claimed", {
            task_id: row.task_id,
            delay_ms: delayMs,
            schedule_type: schedule.type,
          });
          queued += 1;
        }
      }
      return { claimed: rows.length, queued, missed, maxDelayMs };
    });
  }

  private async cleanup(nowMs: number): Promise<number> {
    const rows = rowsFromResult<{ run_id: string }>(await this.db.execute(sql`
      delete from scheduled_task_runs
      where completed_at_ms is not null
        and completed_at_ms < ${nowMs - RUN_RETENTION_MS}
        and status in ('succeeded', 'failed', 'missed', 'skipped')
      returning run_id
    `));
    return rows.length;
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
function numberFromDb(value: number | string | bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("scheduled_task_database_value_invalid");
  return parsed;
}
function jsonFromDb(value: unknown): unknown { if (typeof value !== "string") return value; try { return JSON.parse(value) as unknown; } catch { return value; } }
