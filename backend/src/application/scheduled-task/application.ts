import type {
  ScheduledTaskCreateInput,
  ScheduledTaskListResult,
  ScheduledTaskRunsListResult,
  ScheduledTaskSummary,
  ScheduledTaskUpdateInput,
  ScheduledTaskVersionMutationInput,
} from "@fields/contracts/public/scheduled-task";

export interface ScheduledTaskApplication {
  list(companyId: string, actorId: string): Promise<ScheduledTaskListResult>;
  get(companyId: string, actorId: string, taskId: string): Promise<ScheduledTaskSummary>;
  create(companyId: string, actorId: string, input: ScheduledTaskCreateInput): Promise<ScheduledTaskSummary>;
  update(companyId: string, actorId: string, input: ScheduledTaskUpdateInput): Promise<ScheduledTaskSummary>;
  pause(companyId: string, actorId: string, input: ScheduledTaskVersionMutationInput): Promise<ScheduledTaskSummary>;
  resume(companyId: string, actorId: string, input: ScheduledTaskVersionMutationInput): Promise<ScheduledTaskSummary>;
  runNow(companyId: string, actorId: string, input: ScheduledTaskVersionMutationInput): Promise<ScheduledTaskSummary>;
  softDelete(companyId: string, actorId: string, input: ScheduledTaskVersionMutationInput): Promise<{ task_id: string; deleted: true }>;
  listRuns(companyId: string, actorId: string, taskId: string, cursor: string | null, limit: number): Promise<ScheduledTaskRunsListResult>;
}
