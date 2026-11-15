import { z } from "zod";

import { roomReferenceTargetSchema } from "./room.js";

export const scheduledTaskStatuses = ["active", "paused", "blocked", "completed"] as const;
export const scheduledTaskStatusSchema = z.enum(scheduledTaskStatuses);
export type ScheduledTaskStatus = z.infer<typeof scheduledTaskStatusSchema>;

export const scheduledTaskRunTriggers = ["scheduled", "run_now"] as const;
export const scheduledTaskRunTriggerSchema = z.enum(scheduledTaskRunTriggers);
export type ScheduledTaskRunTrigger = z.infer<typeof scheduledTaskRunTriggerSchema>;

export const scheduledTaskRunStatuses = ["queued", "retrying", "succeeded", "failed", "missed", "skipped"] as const;
export const scheduledTaskRunStatusSchema = z.enum(scheduledTaskRunStatuses);
export type ScheduledTaskRunStatus = z.infer<typeof scheduledTaskRunStatusSchema>;

export const scheduledTaskBlockedReasons = [
  "room_unavailable",
  "home_thread_unavailable",
  "references_unavailable",
  "member_unavailable",
  "executor_unavailable",
  "delivery_failed",
] as const;
export const scheduledTaskBlockedReasonSchema = z.enum(scheduledTaskBlockedReasons);
export type ScheduledTaskBlockedReason = z.infer<typeof scheduledTaskBlockedReasonSchema>;

const fiveFieldCronSchema = z.string().trim().min(9).max(255).refine(
  (value) => value.split(/\s+/u).length === 5 && !value.startsWith("@"),
  { message: "A standard five-field Cron expression is required." },
);

export const scheduledTaskScheduleSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("once"), at_ms: z.number().int().nonnegative() }),
  z.strictObject({
    type: z.literal("cron"),
    expression: fiveFieldCronSchema,
    timezone: z.string().trim().min(1).max(255),
  }),
  z.strictObject({
    type: z.literal("heartbeat"),
    interval_minutes: z.number().int().min(10).max(525_600),
  }),
]);
export type ScheduledTaskSchedule = z.infer<typeof scheduledTaskScheduleSchema>;

function validateHomeTarget(
  target: { thread_mode: "existing" | "new_each_run"; thread_id: string | null },
  context: z.RefinementCtx,
): void {
  if ((target.thread_mode === "existing") !== (target.thread_id !== null)) {
    context.addIssue({
      code: "custom",
      path: ["thread_id"],
      message: "An existing Home target requires exactly one Thread id.",
    });
  }
}

export const scheduledTaskTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("home"),
    owner_member_id: z.string().min(1),
    thread_mode: z.enum(["existing", "new_each_run"]),
    thread_id: z.string().min(1).nullable(),
  }).superRefine(validateHomeTarget),
  z.strictObject({ kind: z.literal("room"), room_id: z.string().min(1) }),
]);
export type ScheduledTaskTarget = z.infer<typeof scheduledTaskTargetSchema>;

export const scheduledTaskCreateTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("home"),
    thread_mode: z.enum(["existing", "new_each_run"]),
    thread_id: z.string().min(1).nullable(),
  }).superRefine(validateHomeTarget),
  z.strictObject({ kind: z.literal("room"), room_id: z.string().min(1) }),
]);
export type ScheduledTaskCreateTarget = z.infer<typeof scheduledTaskCreateTargetSchema>;

export const scheduledTaskContentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("home"), prompt: z.string().trim().min(1).max(200_000) }),
  z.strictObject({
    kind: z.literal("room"),
    markdown: z.string().trim().min(1).max(200_000),
    references: z.array(roomReferenceTargetSchema).max(100),
    reply_to_message_ids: z.array(z.string().min(1)).max(100),
  }),
]);
export type ScheduledTaskContent = z.infer<typeof scheduledTaskContentSchema>;

export const scheduledTaskSummarySchema = z.strictObject({
  task_id: z.string().min(1),
  company_id: z.string().min(1),
  created_by_member_id: z.string().min(1),
  name: z.string().min(1).max(255),
  target: scheduledTaskTargetSchema,
  content: scheduledTaskContentSchema,
  schedule: scheduledTaskScheduleSchema,
  status: scheduledTaskStatusSchema,
  next_run_at_ms: z.number().int().nonnegative().nullable(),
  max_executions: z.number().int().positive().nullable(),
  successful_executions: z.number().int().nonnegative(),
  remaining_executions: z.number().int().nonnegative().nullable(),
  version: z.number().int().positive(),
  blocked_reason: scheduledTaskBlockedReasonSchema.nullable(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type ScheduledTaskSummary = z.infer<typeof scheduledTaskSummarySchema>;

export const scheduledTaskRunSummarySchema = z.strictObject({
  run_id: z.string().min(1),
  task_id: z.string().min(1),
  trigger: scheduledTaskRunTriggerSchema,
  status: scheduledTaskRunStatusSchema,
  scheduled_for_ms: z.number().int().nonnegative().nullable(),
  started_at_ms: z.number().int().nonnegative().nullable(),
  completed_at_ms: z.number().int().nonnegative().nullable(),
  attempt_count: z.number().int().nonnegative(),
  error_reason: scheduledTaskBlockedReasonSchema.nullable(),
  room_id: z.string().min(1).nullable(),
  room_message_id: z.string().min(1).nullable(),
  home_thread_id: z.string().min(1).nullable(),
  home_turn_id: z.string().min(1).nullable(),
  created_at_ms: z.number().int().nonnegative(),
});
export type ScheduledTaskRunSummary = z.infer<typeof scheduledTaskRunSummarySchema>;

export const scheduledTaskListInputSchema = z.strictObject({});
export const scheduledTaskListResultSchema = z.strictObject({ items: z.array(scheduledTaskSummarySchema) });
export const scheduledTaskGetInputSchema = z.strictObject({ task_id: z.string().min(1) });

const scheduledTaskCreateBaseSchema = z.strictObject({
  name: z.string().trim().min(1).max(255).optional(),
  target: scheduledTaskCreateTargetSchema,
  content: scheduledTaskContentSchema,
  schedule: scheduledTaskScheduleSchema,
  max_executions: z.number().int().positive().nullable().default(null),
  idempotency_key: z.string().min(1).max(255),
});
export const scheduledTaskCreateInputSchema = scheduledTaskCreateBaseSchema.superRefine((input, context) => {
  if (input.target.kind !== input.content.kind) {
    context.addIssue({ code: "custom", path: ["content", "kind"], message: "Task content must match its target kind." });
  }
  if (input.schedule.type === "once" && input.max_executions !== null && input.max_executions !== 1) {
    context.addIssue({ code: "custom", path: ["max_executions"], message: "One-time tasks execute exactly once." });
  }
});

export const scheduledTaskUpdateInputSchema = z.strictObject({
  task_id: z.string().min(1),
  name: z.string().trim().min(1).max(255),
  content: scheduledTaskContentSchema,
  schedule: scheduledTaskScheduleSchema,
  max_executions: z.number().int().positive().nullable(),
  expected_version: z.number().int().positive(),
  idempotency_key: z.string().min(1).max(255),
}).superRefine((input, context) => {
  if (input.schedule.type === "once" && input.max_executions !== 1) {
    context.addIssue({ code: "custom", path: ["max_executions"], message: "One-time tasks execute exactly once." });
  }
});

export const scheduledTaskVersionMutationInputSchema = z.strictObject({
  task_id: z.string().min(1),
  expected_version: z.number().int().positive(),
  idempotency_key: z.string().min(1).max(255),
});
export const scheduledTaskDeleteResultSchema = z.strictObject({ task_id: z.string().min(1), deleted: z.literal(true) });
export const scheduledTaskRunsListInputSchema = z.strictObject({
  task_id: z.string().min(1),
  cursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const scheduledTaskRunsListResultSchema = z.strictObject({
  items: z.array(scheduledTaskRunSummarySchema),
  page: z.strictObject({ next_cursor: z.string().min(1).nullable() }),
});

export type ScheduledTaskListInput = z.infer<typeof scheduledTaskListInputSchema>;
export type ScheduledTaskListResult = z.infer<typeof scheduledTaskListResultSchema>;
export type ScheduledTaskGetInput = z.infer<typeof scheduledTaskGetInputSchema>;
export type ScheduledTaskCreateInput = z.infer<typeof scheduledTaskCreateInputSchema>;
export type ScheduledTaskUpdateInput = z.infer<typeof scheduledTaskUpdateInputSchema>;
export type ScheduledTaskVersionMutationInput = z.infer<typeof scheduledTaskVersionMutationInputSchema>;
export type ScheduledTaskDeleteResult = z.infer<typeof scheduledTaskDeleteResultSchema>;
export type ScheduledTaskRunsListInput = z.infer<typeof scheduledTaskRunsListInputSchema>;
export type ScheduledTaskRunsListResult = z.infer<typeof scheduledTaskRunsListResultSchema>;
