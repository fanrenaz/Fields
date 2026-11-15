import type { BackendRouter } from "@fields/contracts/router/backend";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import {
  scheduledTaskCreateInputSchema,
  scheduledTaskDeleteResultSchema,
  scheduledTaskGetInputSchema,
  scheduledTaskListInputSchema,
  scheduledTaskListResultSchema,
  scheduledTaskRunsListInputSchema,
  scheduledTaskRunsListResultSchema,
  scheduledTaskSummarySchema,
  scheduledTaskUpdateInputSchema,
  scheduledTaskVersionMutationInputSchema,
} from "@fields/contracts/public/scheduled-task";

import { requireProductSession, t } from "./core.js";
import {
  createPublicTrpcRouterRecord,
  createRoomPublicTrpcRouterRecord,
} from "./public/index.js";
import { createRuntimeTrpcRouterRecord } from "./runtime/index.js";

/** Interface-owned public and internal tRPC route assembly. */
export function createBackendTrpcRouter() {
  return t.router({
    ...createPublicTrpcRouterRecord(),
    room: t.router(createRoomPublicTrpcRouterRecord()),
    scheduledTasks: t.router({
      list: t.procedure.input(scheduledTaskListInputSchema).output(scheduledTaskListResultSchema).query(({ ctx }) => {
        const session = requireProductSession(ctx);
        return ctx.scheduledTasks.list(session.company_id, session.actor_id);
      }),
      get: t.procedure.input(scheduledTaskGetInputSchema).output(scheduledTaskSummarySchema).query(({ ctx, input }) => {
        const session = requireProductSession(ctx);
        return ctx.scheduledTasks.get(session.company_id, session.actor_id, input.task_id);
      }),
      create: t.procedure.input(scheduledTaskCreateInputSchema).output(scheduledTaskSummarySchema).mutation(({ ctx, input }) => {
        const session = requireProductSession(ctx);
        return ctx.scheduledTasks.create(session.company_id, session.actor_id, input);
      }),
      update: t.procedure.input(scheduledTaskUpdateInputSchema).output(scheduledTaskSummarySchema).mutation(({ ctx, input }) => {
        const session = requireProductSession(ctx);
        return ctx.scheduledTasks.update(session.company_id, session.actor_id, input);
      }),
      pause: t.procedure.input(scheduledTaskVersionMutationInputSchema).output(scheduledTaskSummarySchema).mutation(({ ctx, input }) => {
        const session = requireProductSession(ctx);
        return ctx.scheduledTasks.pause(session.company_id, session.actor_id, input);
      }),
      resume: t.procedure.input(scheduledTaskVersionMutationInputSchema).output(scheduledTaskSummarySchema).mutation(({ ctx, input }) => {
        const session = requireProductSession(ctx);
        return ctx.scheduledTasks.resume(session.company_id, session.actor_id, input);
      }),
      runNow: t.procedure.input(scheduledTaskVersionMutationInputSchema).output(scheduledTaskSummarySchema).mutation(({ ctx, input }) => {
        const session = requireProductSession(ctx);
        return ctx.scheduledTasks.runNow(session.company_id, session.actor_id, input);
      }),
      softDelete: t.procedure.input(scheduledTaskVersionMutationInputSchema).output(scheduledTaskDeleteResultSchema).mutation(({ ctx, input }) => {
        const session = requireProductSession(ctx);
        return ctx.scheduledTasks.softDelete(session.company_id, session.actor_id, input);
      }),
      runs: t.router({
        list: t.procedure.input(scheduledTaskRunsListInputSchema).output(scheduledTaskRunsListResultSchema).query(({ ctx, input }) => {
          const session = requireProductSession(ctx);
          return ctx.scheduledTasks.listRuns(session.company_id, session.actor_id, input.task_id, input.cursor ?? null, input.limit);
        }),
      }),
    }),
    ...createRuntimeTrpcRouterRecord(),
  });
}

type ActualBackendRouter = ReturnType<typeof createBackendTrpcRouter>;
type BackendContractInputs = inferRouterInputs<BackendRouter>;
type BackendContractOutputs = inferRouterOutputs<BackendRouter>;
type ActualPublicBackendInputs = Pick<
  inferRouterInputs<ActualBackendRouter>,
  keyof BackendContractInputs
>;
type ActualPublicBackendOutputs = Pick<
  inferRouterOutputs<ActualBackendRouter>,
  keyof BackendContractOutputs
>;
type AssertRouterContract<T extends true> = T;
type _BackendRouterContractInputGate = AssertRouterContract<
  BackendContractInputs extends ActualPublicBackendInputs ? true : false
>;
type _BackendRouterContractOutputGate = AssertRouterContract<
  ActualPublicBackendOutputs extends BackendContractOutputs ? true : false
>;
