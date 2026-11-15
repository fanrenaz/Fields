import {
  companyRuntimeAgentActivityInputSchema,
  companyExecutorCredentialUpdatedInputSchema,
  companyExecutorUnavailableInputSchema,
  companyRuntimeAgentExecutionCompletionInputSchema,
  companyRuntimeAgentExecutionProgressInputSchema,
  companyRuntimeFailedInputSchema,
  companyRuntimeHeartbeatInputSchema,
  companyRuntimeIdentitySchema,
  companyRuntimeFileListInputSchema,
  companyRuntimeFileListResultSchema,
  companyRuntimeFileReadInputSchema,
  companyRuntimeFileReadResultSchema,
  companyRuntimeFileUploadBeginInputSchema,
  companyRuntimeFileUploadFinalizeInputSchema,
  companyRuntimeFileUploadResultSchema,
  companyRuntimeRoomMessagesReadInputSchema,
  companyRuntimeRoomMessagesReadResultSchema,
  companyRuntimeSearchQueryInputSchema,
  companyRuntimeSearchQueryResultSchema,
  type CompanyRuntimeIdentity,
} from "@fields/contracts/internal/company-runtime";
import {
  roomCodexAgentRuntimeActivityAcceptedSchema,
} from "@fields/contracts/internal/agent-runtime";

import {
  bearerToken,
  publicError,
  t,
  type BackendTrpcContext,
} from "../core.js";
import { readRoomMessagesResource } from "../../../application/room/queries/read-room-messages-resource.js";
import { runGlobalSearch } from "../../../application/search/global-search.js";
import {
  runtimeAgentAssetArchiveInputSchema,
  runtimeAgentAssetBeginZipInputSchema,
  runtimeAgentAssetContentReadInputSchema,
  runtimeAgentAssetContentResultSchema,
  runtimeAgentAssetCreateMcpInputSchema,
  runtimeAgentAssetCredentialReplaceInputSchema,
  runtimeAgentAssetDetailResultSchema,
  runtimeAgentAssetDraftDeleteResultSchema,
  runtimeAgentAssetDraftMutationResultSchema,
  runtimeAgentAssetImportGitInputSchema,
  runtimeAgentAssetImportWorkspaceZipInputSchema,
  runtimeAgentAssetListInputSchema,
  runtimeAgentAssetListResultSchema,
  runtimeAgentAssetMutationResultSchema,
  runtimeAgentAssetPublishResultSchema,
  runtimeAgentAssetReadInputSchema,
  runtimeAgentAssetRevisionInputSchema,
  runtimeAgentAssetUpdateInputSchema,
  runtimeAgentMemberAssetApplyInputSchema,
  runtimeAgentMemberAssetCurrentInputSchema,
  runtimeAgentMemberAssetOptionsInputSchema,
  runtimeAgentMemberAssetOptionsResultSchema,
  runtimeAgentMemberAssetProfileResultSchema,
  runtimeMemberAssetOperationCompletedInputSchema,
} from "@fields/contracts/internal/asset";
import {
  runtimeMemberMailboxListInputSchema,
  runtimeMemberMailboxListResultSchema,
  runtimeMailboxAuditInputSchema,
  runtimeMailboxOperationAckSchema,
} from "@fields/contracts/internal/mail";
import { companyFileUploadReservationSchema } from "@fields/contracts/public/company-file";
import {
  runtimeMemberMemoryCompletedInputSchema,
} from "@fields/contracts/internal/member-memory";
import { homeTerminalNotificationInputSchema, homeTerminalNotificationResultSchema } from "@fields/contracts/internal/notification";

/**
 * Runtime-only callbacks mounted under the Backend tRPC transport. Every
 * mutation is authorized against the configured Company Runtime identity
 * before its payload can change Backend-owned state.
 */
export function createRuntimeTrpcRouterRecord() {
  return {
    companyRuntime: t.router({
      notifications: t.router({
        homeTerminal: t.procedure.input(homeTerminalNotificationInputSchema).output(homeTerminalNotificationResultSchema).mutation(async ({ ctx, input }) => {
          await authorizeRuntimeMember(ctx, input.identity, input.recipient_actor_id);
          return ctx.notifications.acceptHomeTerminal(input);
        }),
      }),
      memory: t.router({
        completed: t.procedure
          .input(runtimeMemberMemoryCompletedInputSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntime(ctx, input.identity);
            await ctx.memberMemory.complete({
              companyId: input.identity.company_id,
              memberId: input.member_id,
              operationId: input.operation_id,
              appliedEnabled: input.applied_enabled,
              status: input.status,
              errorCode: input.error_code,
              completedAtMs: input.completed_at_ms,
            });
          }),
      }),
      mail: t.router({
        mailboxes: t.procedure
          .input(runtimeMemberMailboxListInputSchema)
          .output(runtimeMemberMailboxListResultSchema)
          .query(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input.identity, input.member_id);
            return ctx.mail.listMailboxes({
              companyId: input.identity.company_id,
              actorId: input.member_id,
              isCompanyOwner: false,
            });
          }),
        audit: t.procedure
          .input(runtimeMailboxAuditInputSchema)
          .output(runtimeMailboxOperationAckSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input.identity, input.member_id);
            return ctx.mail.recordRuntimeAudit({
              companyId: input.identity.company_id,
              actorId: input.member_id,
              isCompanyOwner: false,
            }, {
              operationId: input.operation_id,
              mailboxId: input.mailbox_id,
              operation: input.operation,
              itemCount: input.item_count,
              sizeBytes: input.size_bytes,
              outcome: input.outcome,
            });
          }),
      }),
      assets: t.router({
        installations: t.router({
          current: t.procedure
            .input(runtimeAgentMemberAssetCurrentInputSchema)
            .output(runtimeAgentMemberAssetProfileResultSchema)
            .query(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input.identity, input.member_id);
              return ctx.memberAssets.current(
                input.identity.company_id,
                input.member_id,
                input.member_id,
                "self_agent",
              );
            }),
          options: t.procedure
            .input(runtimeAgentMemberAssetOptionsInputSchema)
            .output(runtimeAgentMemberAssetOptionsResultSchema)
            .query(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input.identity, input.member_id);
              return ctx.memberAssets.options(
                input.identity.company_id,
                input.member_id,
                input.member_id,
                input.input,
                "self_agent",
              );
            }),
          applyInstallation: t.procedure
            .input(runtimeAgentMemberAssetApplyInputSchema)
            .output(runtimeAgentMemberAssetProfileResultSchema)
            .mutation(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input.identity, input.member_id);
              return ctx.memberAssets.apply({
                companyId: input.identity.company_id,
                requestedByActorId: input.member_id,
                memberId: input.member_id,
                expectedRevision: input.input.expected_revision,
                installations: input.input.installations,
                idempotencyKey: input.input.idempotency_key,
                authority: "self_agent",
              });
            }),
        }),
        installationCompleted: t.procedure
          .input(runtimeMemberAssetOperationCompletedInputSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntime(ctx, input.identity);
            await ctx.memberAssets.complete(input);
          }),
        list: t.procedure
          .input(runtimeAgentAssetListInputSchema)
          .output(runtimeAgentAssetListResultSchema)
          .query(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input.identity, input.member_id);
            return ctx.assets.list(input.identity.company_id, input.member_id, input.input);
          }),
        read: t.procedure
          .input(runtimeAgentAssetReadInputSchema)
          .output(runtimeAgentAssetDetailResultSchema)
          .query(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input.identity, input.member_id);
            return ctx.assets.read(
              input.identity.company_id,
              input.member_id,
              input.input.asset_id,
            );
          }),
        contentRead: t.procedure
          .input(runtimeAgentAssetContentReadInputSchema)
          .output(runtimeAgentAssetContentResultSchema)
          .query(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input.identity, input.member_id);
            return ctx.assets.contentRead(
              input.identity.company_id,
              input.member_id,
              input.input,
            );
          }),
        draft: t.router({
          beginZip: t.procedure
            .input(runtimeAgentAssetBeginZipInputSchema)
            .output(runtimeAgentAssetDraftMutationResultSchema)
            .mutation(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input.identity, input.member_id);
              return ctx.assets.beginZip(
                input.identity.company_id,
                input.member_id,
                input.input,
              );
            }),
          importGit: t.procedure
            .input(runtimeAgentAssetImportGitInputSchema)
            .output(runtimeAgentAssetDraftMutationResultSchema)
            .mutation(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input.identity, input.member_id);
              return ctx.assets.importGit(
                input.identity.company_id,
                input.member_id,
                input.input,
              );
            }),
          importWorkspaceZip: t.procedure
            .input(runtimeAgentAssetImportWorkspaceZipInputSchema)
            .output(runtimeAgentAssetDraftMutationResultSchema)
            .mutation(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input.identity, input.member_id);
              return ctx.assets.importWorkspaceZip(
                input.identity.company_id,
                input.member_id,
                input.input,
              );
            }),
          createMcp: t.procedure
            .input(runtimeAgentAssetCreateMcpInputSchema)
            .output(runtimeAgentAssetDraftMutationResultSchema)
            .mutation(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input.identity, input.member_id);
              return ctx.assets.createMcp(
                input.identity.company_id,
                input.member_id,
                input.input,
              );
            }),
          update: t.procedure
            .input(runtimeAgentAssetUpdateInputSchema)
            .output(runtimeAgentAssetDraftMutationResultSchema)
            .mutation(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input.identity, input.member_id);
              return ctx.assets.updateDraft(
                input.identity.company_id,
                input.member_id,
                input.input,
              );
            }),
          validate: t.procedure
            .input(runtimeAgentAssetRevisionInputSchema)
            .output(runtimeAgentAssetDraftMutationResultSchema)
            .mutation(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input.identity, input.member_id);
              return ctx.assets.validateDraft(
                input.identity.company_id,
                input.member_id,
                input.input,
              );
            }),
          delete: t.procedure
            .input(runtimeAgentAssetRevisionInputSchema)
            .output(runtimeAgentAssetDraftDeleteResultSchema)
            .mutation(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input.identity, input.member_id);
              return ctx.assets.deleteDraft(
                input.identity.company_id,
                input.member_id,
                input.input,
              );
            }),
        }),
        publish: t.procedure
          .input(runtimeAgentAssetRevisionInputSchema)
          .output(runtimeAgentAssetPublishResultSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input.identity, input.member_id);
            return ctx.assets.publish(
              input.identity.company_id,
              input.member_id,
              input.input,
            );
          }),
        archive: t.procedure
          .input(runtimeAgentAssetArchiveInputSchema)
          .output(runtimeAgentAssetMutationResultSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input.identity, input.member_id);
            return ctx.assets.archive(
              input.identity.company_id,
              input.member_id,
              input.input,
            );
          }),
        restore: t.procedure
          .input(runtimeAgentAssetArchiveInputSchema)
          .output(runtimeAgentAssetMutationResultSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input.identity, input.member_id);
            return ctx.assets.restore(
              input.identity.company_id,
              input.member_id,
              input.input,
            );
          }),
        credentialReplace: t.procedure
          .input(runtimeAgentAssetCredentialReplaceInputSchema)
          .output(runtimeAgentAssetMutationResultSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input.identity, input.member_id);
            return ctx.assets.replaceCredential(
              input.identity.company_id,
              input.member_id,
              input.input,
            );
          }),
      }),
      ready: t.procedure
        .input(companyRuntimeIdentitySchema)
        .mutation(async ({ ctx, input }) => {
          await authorizeRuntime(ctx, input);
          await ctx.runtimeRepository.recordReady(input, Date.now());
        }),
      heartbeat: t.procedure
        .input(companyRuntimeHeartbeatInputSchema)
        .mutation(async ({ ctx, input }) => {
          await authorizeRuntime(ctx, input);
          await ctx.runtimeRepository.recordHeartbeat(input);
        }),
      failed: t.procedure
        .input(companyRuntimeFailedInputSchema)
        .mutation(async ({ ctx, input }) => {
          await authorizeRuntime(ctx, input);
          await ctx.runtimeRepository.recordFailed(input);
        }),
      executor: t.router({
        credentialUpdated: t.procedure
          .input(companyExecutorCredentialUpdatedInputSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntime(ctx, input);
            await ctx.runtimeRepository.recordCredentialUpdated(input);
          }),
        unavailable: t.procedure
          .input(companyExecutorUnavailableInputSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntime(ctx, input);
            await ctx.runtimeRepository.recordExecutorUnavailable(input);
          }),
      }),
      agentExecution: t.router({
        activity: t.procedure
          .input(companyRuntimeAgentActivityInputSchema)
          .output(roomCodexAgentRuntimeActivityAcceptedSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntime(ctx, input);
            if (
              input.event.scope.type !== "room"
              || input.event.scope.execution_id.length === 0
            ) {
              throw new Error("Runtime Agent activity must identify a Room execution.");
            }
            const previous = await ctx.roomMessages.readLatestActivitySnapshot(
              input.event.scope.execution_id,
            );
            const projection = ctx.agentRuntimeActivity.project({
              previous,
              event: input.event,
            });
            const accepted = await ctx.roomMessages.recordActivityProjection({
              eventId: input.event.event_id,
              executionId: input.event.scope.execution_id,
              roomId: input.event.scope.room_id,
              agentMemberId: input.event.scope.agent_member_id,
              occurredAtMs: input.event.occurred_at_ms,
              snapshot: projection.snapshot,
              interaction: projection.interaction,
              resolvedInteractionId: projection.resolvedInteractionId,
            });
            return {
              accepted: true as const,
              event_id: accepted.eventId,
              duplicate: accepted.duplicate,
              interaction_id: accepted.interactionId,
            };
          }),
        progress: t.procedure
          .input(companyRuntimeAgentExecutionProgressInputSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntime(ctx, input);
            await ctx.roomMessages.recordExecutionProgress(input.progress);
          }),
        complete: t.procedure
          .input(companyRuntimeAgentExecutionCompletionInputSchema)
          .mutation(async ({ ctx, input }) => {
            await authorizeRuntime(ctx, input);
            await ctx.roomMessages.completeExecution(input.completion);
          }),
      }),
      roomMessages: t.router({
        read: t.procedure
          .input(companyRuntimeRoomMessagesReadInputSchema)
          .output(companyRuntimeRoomMessagesReadResultSchema)
          .query(async ({ ctx, input }) => {
            await authorizeRuntime(ctx, input);
            return readRoomMessagesResource(ctx, input);
          }),
      }),
      search: t.router({
        query: t.procedure
          .input(companyRuntimeSearchQueryInputSchema)
          .output(companyRuntimeSearchQueryResultSchema)
          .query(async ({ ctx, input }) => {
            await authorizeRuntime(ctx, input);
            return runGlobalSearch(ctx, input.company_id, input.member_id, input.query);
          }),
      }),
      files: t.router({
        list: t.procedure
          .input(companyRuntimeFileListInputSchema)
          .output(companyRuntimeFileListResultSchema)
          .query(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input, input.member_id);
            return ctx.companyFiles.list(input.company_id, input.input);
          }),
        read: t.procedure
          .input(companyRuntimeFileReadInputSchema)
          .output(companyRuntimeFileReadResultSchema)
          .query(async ({ ctx, input }) => {
            await authorizeRuntimeMember(ctx, input, input.member_id);
            return ctx.companyFiles.download(input.company_id, {
              ...input.input,
              disposition: "attachment",
            }, "runtime");
          }),
        upload: t.router({
          begin: t.procedure
            .input(companyRuntimeFileUploadBeginInputSchema)
            .output(companyFileUploadReservationSchema)
            .mutation(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input, input.member_id);
              return ctx.companyFiles.beginUpload(input.company_id, input.member_id, input.input, "runtime");
            }),
          finalize: t.procedure
            .input(companyRuntimeFileUploadFinalizeInputSchema)
            .output(companyRuntimeFileUploadResultSchema)
            .mutation(async ({ ctx, input }) => {
              await authorizeRuntimeMember(ctx, input, input.member_id);
              return ctx.companyFiles.finalizeUpload(input.company_id, input.member_id, input.input);
            }),
        }),
      }),
    }),
  };
}

async function authorizeRuntime(
  ctx: BackendTrpcContext,
  identity: CompanyRuntimeIdentity,
): Promise<void> {
  try {
    await ctx.runtimeRepository.authorize(identity, bearerToken(ctx.authorizationHeader));
  } catch (error) {
    publicError(error);
  }
}

async function authorizeRuntimeMember(
  ctx: BackendTrpcContext,
  identity: CompanyRuntimeIdentity,
  memberId: string,
): Promise<void> {
  await authorizeRuntime(ctx, identity);
  try {
    await ctx.companyActors.requireActiveOrdinaryActor.execute({
      actorId: memberId,
      companyId: identity.company_id,
    });
  } catch (error) {
    publicError(error);
  }
}
