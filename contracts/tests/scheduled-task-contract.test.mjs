import assert from "node:assert/strict";
import test from "node:test";

import {
  scheduledTaskCreateInputSchema,
  scheduledTaskListInputSchema,
  scheduledTaskRunSummarySchema,
  scheduledTaskScheduleSchema,
  scheduledTaskSummarySchema,
  scheduledTaskUpdateInputSchema,
} from "../dist/public/scheduled-task.js";

const homeTarget = { kind: "home", thread_mode: "new_each_run", thread_id: null };
const homeContent = { kind: "home", prompt: "Prepare the daily brief" };

test("scheduled-task contracts keep provider-neutral schedule and target unions strict", () => {
  assert.equal(scheduledTaskScheduleSchema.safeParse({ type: "once", at_ms: 100 }).success, true);
  assert.equal(scheduledTaskScheduleSchema.safeParse({ type: "cron", expression: "0 9 * * 1-5", timezone: "Asia/Shanghai" }).success, true);
  assert.equal(scheduledTaskScheduleSchema.safeParse({ type: "heartbeat", interval_minutes: 10 }).success, true);
  assert.equal(scheduledTaskScheduleSchema.safeParse({ type: "cron", expression: "0 0 9 * * *", timezone: "UTC" }).success, false);
  assert.equal(scheduledTaskScheduleSchema.safeParse({ type: "heartbeat", interval_minutes: 9 }).success, false);
});

test("create and update enforce matching content, immutable targets, versions, and once limits", () => {
  assert.equal(scheduledTaskCreateInputSchema.safeParse({ target: homeTarget, content: homeContent, schedule: { type: "once", at_ms: 100 }, max_executions: 1, idempotency_key: "create-1" }).success, true);
  assert.equal(scheduledTaskCreateInputSchema.safeParse({ target: homeTarget, content: { kind: "room", markdown: "x", references: [], reply_to_message_ids: [] }, schedule: { type: "once", at_ms: 100 }, max_executions: 1, idempotency_key: "create-2" }).success, false);
  const update = { task_id: "task-1", name: "Brief", content: homeContent, schedule: { type: "heartbeat", interval_minutes: 10 }, max_executions: null, expected_version: 2, idempotency_key: "update-1" };
  assert.equal(scheduledTaskUpdateInputSchema.safeParse(update).success, true);
  assert.equal(scheduledTaskUpdateInputSchema.safeParse({ ...update, target: homeTarget }).success, false);
});

test("list input is empty and legacy scope discriminators are rejected", () => {
  assert.equal(scheduledTaskListInputSchema.safeParse({}).success, true);
  assert.equal(scheduledTaskListInputSchema.safeParse({ scope: "home" }).success, false);
  assert.equal(scheduledTaskCreateInputSchema.safeParse({ target: { scope: "home", thread_mode: "new_each_run", thread_id: null }, content: homeContent, schedule: { type: "once", at_ms: 100 }, max_executions: 1, idempotency_key: "legacy-target" }).success, false);
  assert.equal(scheduledTaskCreateInputSchema.safeParse({ target: homeTarget, content: { scope: "home", prompt: "legacy" }, schedule: { type: "once", at_ms: 100 }, max_executions: 1, idempotency_key: "legacy-content" }).success, false);
});

test("task and run outputs reject raw provider data and expose only safe result identifiers", () => {
  const task = { task_id: "task-1", company_id: "company-1", created_by_member_id: "member-1", name: "Brief", target: { ...homeTarget, owner_member_id: "member-1" }, content: homeContent, schedule: { type: "heartbeat", interval_minutes: 10 }, status: "active", next_run_at_ms: 100, max_executions: null, successful_executions: 0, remaining_executions: null, version: 1, blocked_reason: null, created_at_ms: 1, updated_at_ms: 1 };
  assert.equal(scheduledTaskSummarySchema.safeParse(task).success, true);
  assert.equal(scheduledTaskSummarySchema.safeParse({ ...task, provider_payload: { secret: true } }).success, false);
  const run = { run_id: "run-1", task_id: "task-1", trigger: "scheduled", status: "succeeded", scheduled_for_ms: 100, started_at_ms: 101, completed_at_ms: 102, attempt_count: 1, error_reason: null, room_id: null, room_message_id: null, home_thread_id: "thread-1", home_turn_id: "turn-1", created_at_ms: 100 };
  assert.equal(scheduledTaskRunSummarySchema.safeParse(run).success, true);
  assert.equal(scheduledTaskRunSummarySchema.safeParse({ ...run, error_message: "secret" }).success, false);
});
