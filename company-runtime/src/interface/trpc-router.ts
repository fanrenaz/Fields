import {
  homeFilesystemDeleteResultSchema,
  homeFilesystemEntrySchema,
  homeFilesystemEventStreamSchema,
  homeFilesystemListResultSchema,
  homeModelOptionsResultSchema,
  homeProjectDeleteResultSchema,
  homeProjectListResultSchema,
  homeProjectSchema,
  homeProjectThreadMoveResultSchema,
  homeThreadListResultSchema,
  homeThreadDeleteResultSchema,
  homeThreadForkResultSchema,
  homeThreadReadResultSchema,
  homeThreadSelectResultSchema,
  homeThreadSearchResultSchema,
  homeThreadSettingsResultSchema,
  homeTurnSubmitResultSchema,
  homeQuestionInteractionRespondResultSchema,
  homeQuestionInteractionSnoozeResultSchema,
  homeConversationImportSchema,
} from "@fields/contracts/public/home";
import {
  homeFilesystemSearchResultSchema,
} from "@fields/contracts/public/search";
import {
  codexAgentRuntimeEventStreamSchema,
} from "@fields/contracts/internal/agent-runtime";
import {
  companyExecutorAuthAttemptInputSchema,
  companyExecutorAuthCancelResultSchema,
  companyExecutorAuthStartInputSchema,
  companyExecutorAuthStartResultSchema,
  companyExecutorAuthStatusResultSchema,
  companyExecutorCredentialCleanupInputSchema,
  companyExecutorCredentialCleanupResultSchema,
  companyExecutorCustomApiConfigureInputSchema,
  companyExecutorCustomApiConfigureResultSchema,
  companyExecutorModelCatalogInputSchema,
  companyExecutorModelCatalogResultSchema,
  companyExecutorModelValidationInputSchema,
  companyExecutorModelValidationResultSchema,
  companyRuntimeAgentRoomExecuteInputSchema,
  companyRuntimeAgentRoomInteractionRespondInputSchema,
  companyRuntimeHeartbeatInputSchema,
  companyRuntimeHomeFilesystemCreateInputSchema,
  companyRuntimeHomeFilesystemDeleteInputSchema,
  companyRuntimeHomeFilesystemEventsInputSchema,
  companyRuntimeHomeFilesystemListInputSchema,
  companyRuntimeHomeFilesystemRenameInputSchema,
  companyRuntimeHomeFilesystemSearchInputSchema,
  companyRuntimeHomeModelOptionsInputSchema,
  companyRuntimeHomeProjectCreateInputSchema,
  companyRuntimeHomeProjectDeleteInputSchema,
  companyRuntimeHomeProjectListInputSchema,
  companyRuntimeHomeProjectThreadMoveInputSchema,
  companyRuntimeHomeProjectUpdateInputSchema,
  companyRuntimeHomeThreadListInputSchema,
  companyRuntimeHomeThreadDeleteInputSchema,
  companyRuntimeHomeThreadForkInputSchema,
  companyRuntimeHomeThreadReadInputSchema,
  companyRuntimeHomeThreadSelectInputSchema,
  companyRuntimeHomeThreadSearchInputSchema,
  companyRuntimeHomeThreadSettingsInputSchema,
  companyRuntimeHomeThreadSettingsSetInputSchema,
  companyRuntimeHomeTurnEventsInputSchema,
  companyRuntimeHomeAllTurnEventsInputSchema,
  companyRuntimeHomeTurnSubmitInputSchema,
  companyRuntimeHomeQuestionInteractionRespondInputSchema,
  companyRuntimeHomeQuestionInteractionSnoozeInputSchema,
  companyRuntimeHomeConversationImportReadInputSchema,
  companyRuntimeRoomSideChatThreadReadInputSchema,
  companyRuntimeRoomSideChatTurnEventsInputSchema,
  companyRuntimeRoomSideChatTurnSubmitInputSchema,
  companyRuntimeMemberCleanupInputSchema,
  companyRuntimeMemberCleanupResultSchema,
  companyRuntimeProxyDisableInputSchema,
  companyRuntimeProxySetInputSchema,
  companyRuntimeProxyStatusSchema,
  memberAppServerInputSchema,
  memberAppServerStartInputSchema,
  memberAppServerStatusSchema,
  memberAppServerStopResultSchema,
  memberExecutorSwitchInputSchema,
  memberExecutorSwitchResultSchema,
  type MemberAppServerStatus,
} from "@fields/contracts/internal/company-runtime";
import {
  agentRoomExecutionAcceptedSchema,
  agentRoomInteractionResponseAcceptedSchema,
} from "@fields/contracts/internal/agent-room";
import {
  assetStoredPackageSchema,
  runtimeAssetContentReadInputSchema,
  runtimeAssetCredentialReplaceInputSchema,
  runtimeAssetCredentialOperationInputSchema,
  runtimeAssetDraftReferenceCasInputSchema,
  runtimeAssetGitImportInputSchema,
  runtimeAssetMcpStoreInputSchema,
  runtimeAssetMcpToolCallInputSchema,
  runtimeAssetMcpToolCallResultSchema,
  runtimeAssetMcpToolsListInputSchema,
  runtimeAssetMcpToolsListResultSchema,
  runtimeAssetMutationAckSchema,
  runtimeAssetPublishReferenceInputSchema,
  runtimeAssetReferenceInputSchema,
  runtimeAssetValidateInputSchema,
  runtimeAssetValidateResultSchema,
  runtimeAssetVersionReferenceInputSchema,
  runtimeAssetWorkspaceZipInputSchema,
  runtimeMemberAssetApplyInputSchema,
  runtimeMemberAssetApplyResultSchema,
} from "@fields/contracts/internal/asset";
import { assetContentSchema } from "@fields/contracts/public/asset";
import {
  mailAttachmentReadResultSchema,
  mailFolderListResultSchema,
  mailMessagePageSchema,
  mailMessageSchema,
  mailMessageUpdateResultSchema,
  mailSendResultSchema,
} from "@fields/contracts/public/mail";
import {
  runtimeMailboxAttachmentReadInputSchema,
  runtimeMailboxAttachmentSaveInputSchema,
  runtimeMailboxAttachmentSaveResultSchema,
  runtimeMailboxConnectionOperationInputSchema,
  runtimeMailboxConnectInputSchema,
  runtimeMailboxConnectResultSchema,
  runtimeMailboxDisconnectInputSchema,
  runtimeMailboxFoldersInputSchema,
  runtimeMailboxMessageListInputSchema,
  runtimeMailboxMessageReadInputSchema,
  runtimeMailboxMessageSearchInputSchema,
  runtimeMailboxMessageUpdateInputSchema,
  runtimeMailboxOperationAckSchema,
  runtimeMailboxSendInputSchema,
} from "@fields/contracts/internal/mail";
import {
  runtimeMemberMemoryApplyInputSchema,
  runtimeMemberMemoryApplyResultSchema,
} from "@fields/contracts/internal/member-memory";
import type {
  CompanyRuntimeRouter as CompanyRuntimeContractRouter,
} from "@fields/contracts/internal/router/company-runtime";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import {
  createEntry,
  deleteEntry,
  filesystemEvents,
  listDirectory,
  renameEntry,
  searchFilesystem,
} from "../application/filesystem/service.js";
import type { MemberAppServerRecord } from "../application/member-runtime/manager.js";
import { internalProcedure, t } from "./trpc/core.js";

export type {
  CompanyRuntimeTrpcContext,
  CompanyRuntimeTrpcDependencies,
} from "./trpc/context.js";

function buildCompanyRuntimeTrpcRouter() {
  return t.router({
    proxy: t.router({
      get: internalProcedure
        .output(companyRuntimeProxyStatusSchema)
        .query(({ ctx }) => ctx.companyProxy.status()),
      set: internalProcedure
        .input(companyRuntimeProxySetInputSchema)
        .output(companyRuntimeProxyStatusSchema)
        .mutation(({ ctx, input }) => ctx.companyProxy.set(input)),
      disable: internalProcedure
        .input(companyRuntimeProxyDisableInputSchema)
        .output(companyRuntimeProxyStatusSchema)
        .mutation(({ ctx, input }) => ctx.companyProxy.disable(input)),
    }),
    mail: t.router({
      connection: t.router({
        connect: internalProcedure
          .input(runtimeMailboxConnectInputSchema)
          .output(runtimeMailboxConnectResultSchema)
          .mutation(({ ctx, input }) => ctx.mail.connect(input)),
        finalize: internalProcedure
          .input(runtimeMailboxConnectionOperationInputSchema)
          .output(runtimeMailboxOperationAckSchema)
          .mutation(({ ctx, input }) => ctx.mail.finalizeConnection(input)),
        rollback: internalProcedure
          .input(runtimeMailboxConnectionOperationInputSchema)
          .output(runtimeMailboxOperationAckSchema)
          .mutation(({ ctx, input }) => ctx.mail.rollbackConnection(input)),
        disconnect: internalProcedure
          .input(runtimeMailboxDisconnectInputSchema)
          .output(runtimeMailboxOperationAckSchema)
          .mutation(({ ctx, input }) => ctx.mail.disconnect(input)),
      }),
      folders: t.router({
        list: internalProcedure
          .input(runtimeMailboxFoldersInputSchema)
          .output(mailFolderListResultSchema)
          .query(({ ctx, input }) => ctx.mail.listFolders(input)),
      }),
      messages: t.router({
        list: internalProcedure
          .input(runtimeMailboxMessageListInputSchema)
          .output(mailMessagePageSchema)
          .query(({ ctx, input }) => ctx.mail.listMessages(input)),
        search: internalProcedure
          .input(runtimeMailboxMessageSearchInputSchema)
          .output(mailMessagePageSchema)
          .query(({ ctx, input }) => ctx.mail.searchMessages(input)),
        read: internalProcedure
          .input(runtimeMailboxMessageReadInputSchema)
          .output(mailMessageSchema)
          .query(({ ctx, input }) => ctx.mail.readMessage(input)),
        send: internalProcedure
          .input(runtimeMailboxSendInputSchema)
          .output(mailSendResultSchema)
          .mutation(({ ctx, input }) => ctx.mail.sendMessage(input)),
        update: internalProcedure
          .input(runtimeMailboxMessageUpdateInputSchema)
          .output(mailMessageUpdateResultSchema)
          .mutation(({ ctx, input }) => ctx.mail.updateMessage(input)),
      }),
      attachments: t.router({
        read: internalProcedure
          .input(runtimeMailboxAttachmentReadInputSchema)
          .output(mailAttachmentReadResultSchema)
          .query(({ ctx, input }) => ctx.mail.readAttachment(input)),
        save: internalProcedure
          .input(runtimeMailboxAttachmentSaveInputSchema)
          .output(runtimeMailboxAttachmentSaveResultSchema)
          .mutation(({ ctx, input }) => ctx.mail.saveAttachment(input)),
      }),
    }),
    assets: t.router({
      draft: t.router({
        importGit: internalProcedure
          .input(runtimeAssetGitImportInputSchema)
          .output(assetStoredPackageSchema)
          .mutation(({ ctx, input }) => ctx.assetStore.importGit(input)),
        importWorkspaceZip: internalProcedure
          .input(runtimeAssetWorkspaceZipInputSchema)
          .output(assetStoredPackageSchema)
          .mutation(({ ctx, input }) => ctx.assetStore.importWorkspaceZip(input)),
        storeMcp: internalProcedure
          .input(runtimeAssetMcpStoreInputSchema)
          .output(assetStoredPackageSchema)
          .mutation(({ ctx, input }) => ctx.assetStore.storeMcp(input)),
        validate: internalProcedure
          .input(runtimeAssetValidateInputSchema)
          .output(runtimeAssetValidateResultSchema)
          .mutation(({ ctx, input }) => ctx.assetStore.validate(input)),
        release: internalProcedure
          .input(runtimeAssetReferenceInputSchema)
          .output(runtimeAssetMutationAckSchema)
          .mutation(async ({ ctx, input }) => {
            await ctx.assetStore.releaseDraft(input.draft_id);
            return { ok: true as const };
          }),
        referenceCas: internalProcedure
          .input(runtimeAssetDraftReferenceCasInputSchema)
          .output(runtimeAssetMutationAckSchema)
          .mutation(async ({ ctx, input }) => {
            await ctx.assetStore.compareAndSwapDraftReference(
              input.draft_id,
              input.expected_content_sha256,
              input.next_content_sha256,
            );
            return { ok: true as const };
          }),
      }),
      publishReference: internalProcedure
        .input(runtimeAssetPublishReferenceInputSchema)
        .output(runtimeAssetMutationAckSchema)
        .mutation(async ({ ctx, input }) => {
          await ctx.assetStore.publishReference(
            input.draft_id,
            input.version_id,
            input.expected_content_sha256,
          );
          return { ok: true as const };
        }),
      releaseVersion: internalProcedure
        .input(runtimeAssetVersionReferenceInputSchema)
        .output(runtimeAssetMutationAckSchema)
        .mutation(async ({ ctx, input }) => {
          await ctx.assetStore.releaseVersion(input.version_id);
          return { ok: true as const };
        }),
      contentRead: internalProcedure
        .input(runtimeAssetContentReadInputSchema)
        .output(assetContentSchema)
        .query(({ ctx, input }) => ctx.assetStore.contentRead(
          input.content_sha256,
          input.path,
        )),
      credentialStage: internalProcedure
        .input(runtimeAssetCredentialReplaceInputSchema)
        .output(runtimeAssetMutationAckSchema)
        .mutation(async ({ ctx, input }) => {
          await ctx.assetStore.stageCredential(input);
          return { ok: true as const };
        }),
      credentialCommit: internalProcedure
        .input(runtimeAssetCredentialOperationInputSchema)
        .output(runtimeAssetMutationAckSchema)
        .mutation(async ({ ctx, input }) => {
          const committed = await ctx.assetStore.commitCredential(input);
          if (committed.target === "version" && committed.outcome === "completed") {
            await ctx.memberAssets.refreshCredential(committed.targetId);
          }
          return { ok: true as const };
        }),
      credentialAbort: internalProcedure
        .input(runtimeAssetCredentialOperationInputSchema)
        .output(runtimeAssetMutationAckSchema)
        .mutation(async ({ ctx, input }) => {
          await ctx.assetStore.abortCredential(input);
          return { ok: true as const };
        }),
      tools: t.router({
        list: internalProcedure
          .input(runtimeAssetMcpToolsListInputSchema)
          .output(runtimeAssetMcpToolsListResultSchema)
          .query(({ ctx, input }) => ctx.assetStore.listMcpTools(input)),
        invoke: internalProcedure
          .input(runtimeAssetMcpToolCallInputSchema)
          .output(runtimeAssetMcpToolCallResultSchema)
          .mutation(({ ctx, input }) => ctx.assetStore.callMcpTool(input)),
      }),
    }),
    runtime: t.router({
      health: internalProcedure
        .output(companyRuntimeHeartbeatInputSchema)
        .query(({ ctx }) => ctx.lifecycle.status()),
      status: internalProcedure
        .output(companyRuntimeHeartbeatInputSchema)
        .query(({ ctx }) => ctx.lifecycle.status()),
    }),
    executor: t.router({
      auth: t.router({
        start: internalProcedure
          .input(companyExecutorAuthStartInputSchema)
          .output(companyExecutorAuthStartResultSchema)
          .mutation(({ ctx, input }) => ctx.companyExecutor.startAuth(input)),
        status: internalProcedure
          .input(companyExecutorAuthAttemptInputSchema)
          .output(companyExecutorAuthStatusResultSchema)
          .query(({ ctx, input }) => ctx.companyExecutor.status(input)),
        cancel: internalProcedure
          .input(companyExecutorAuthAttemptInputSchema)
          .output(companyExecutorAuthCancelResultSchema)
          .mutation(({ ctx, input }) => ctx.companyExecutor.cancel(input)),
      }),
      credential: t.router({
        configureCustom: internalProcedure
          .input(companyExecutorCustomApiConfigureInputSchema)
          .output(companyExecutorCustomApiConfigureResultSchema)
          .mutation(({ ctx, input }) => ctx.companyExecutor.configureCustom(input)),
        cleanup: internalProcedure
          .input(companyExecutorCredentialCleanupInputSchema)
          .output(companyExecutorCredentialCleanupResultSchema)
          .mutation(({ ctx, input }) => ctx.companyExecutor.cleanupCredential(input)),
      }),
      models: t.router({
        catalog: internalProcedure
          .input(companyExecutorModelCatalogInputSchema)
          .output(companyExecutorModelCatalogResultSchema)
          .query(({ ctx, input }) => ctx.companyExecutor.modelCatalog(input)),
        validate: internalProcedure
          .input(companyExecutorModelValidationInputSchema)
          .output(companyExecutorModelValidationResultSchema)
          .mutation(({ ctx, input }) => ctx.companyExecutor.validateModels(input)),
      }),
    }),
    member: t.router({
      memory: t.router({
        configure: internalProcedure
          .input(runtimeMemberMemoryApplyInputSchema)
          .output(runtimeMemberMemoryApplyResultSchema)
          .mutation(({ ctx, input }) => {
            ctx.lifecycle.assertCurrentIdentity(input);
            return ctx.memberMemory.apply(input);
          }),
      }),
      assets: t.router({
        applyInstallation: internalProcedure
          .input(runtimeMemberAssetApplyInputSchema)
          .output(runtimeMemberAssetApplyResultSchema)
          .mutation(({ ctx, input }) => ctx.memberAssets.apply(input)),
      }),
      cleanup: internalProcedure
        .input(companyRuntimeMemberCleanupInputSchema)
        .output(companyRuntimeMemberCleanupResultSchema)
        .mutation(async ({ ctx, input }) => {
          ctx.lifecycle.assertCurrentIdentity(input);
          const result = await ctx.runtime.cleanupMember(input.operation_id, input.member_id);
          await ctx.mail.cleanupMember(input.company_id, input.member_id);
          return result;
        }),
      appServer: t.router({
        start: internalProcedure
          .input(memberAppServerStartInputSchema)
          .output(memberAppServerStatusSchema)
          .mutation(async ({ ctx, input }) => memberStatus(
            await ctx.runtime.ensureMemberAppServer(input.member_id, {
              executorId: input.executor_id,
              credentialVersion: input.credential_version,
              memoryEnabled: input.memory_enabled,
              memoryManaged: input.memory_managed,
              memoryModel: input.memory_model,
            }),
          )),
        status: internalProcedure
          .input(memberAppServerInputSchema)
          .output(memberAppServerStatusSchema)
          .query(({ ctx, input }) => {
            const status = ctx.runtime.memberStatus(input.member_id);
            return status ? memberStatus(status) : stoppedMemberStatus(input.member_id);
          }),
        stop: internalProcedure
          .input(memberAppServerInputSchema)
          .output(memberAppServerStopResultSchema)
          .mutation(({ ctx, input }) => ctx.runtime.stopMemberAppServer(input.member_id)),
        switchExecutor: internalProcedure
          .input(memberExecutorSwitchInputSchema)
          .output(memberExecutorSwitchResultSchema)
          .mutation(async ({ ctx, input }) => {
            const result = await ctx.runtime.switchMemberExecutor(input.member_id, {
              executorId: input.target_executor_id,
              credentialVersion: input.target_credential_version,
              memoryEnabled: input.target_memory_enabled,
              memoryManaged: input.target_memory_managed,
              memoryModel: input.target_memory_model,
            }, input.codex_thread_ids);
            return {
              member_id: input.member_id,
              assignment_version: input.assignment_version,
              outcome: result.switched ? "switched" as const : "rolled_back" as const,
              session_state: "ready" as const,
              executor_id: result.switched ? input.target_executor_id : result.previousExecutorId,
              resumed_codex_thread_ids: result.resumedThreadIds,
              error: result.errorCode === null ? null : { code: result.errorCode, retryable: true },
            };
          }),
      }),
    }),
    home: t.router({
      model: t.router({
        options: internalProcedure
          .input(companyRuntimeHomeModelOptionsInputSchema)
          .output(homeModelOptionsResultSchema)
          .query(({ ctx, input }) => ctx.runtime.listHomeModelOptions(input.member_id)),
      }),
      project: t.router({
        list: internalProcedure
          .input(companyRuntimeHomeProjectListInputSchema)
          .output(homeProjectListResultSchema)
          .query(({ ctx, input }) => ctx.runtime.listHomeProjects(input.member_id)),
        create: internalProcedure
          .input(companyRuntimeHomeProjectCreateInputSchema)
          .output(homeProjectSchema)
          .mutation(({ ctx, input }) => ctx.runtime.createHomeProject({ memberId: input.member_id, name: input.name })),
        update: internalProcedure
          .input(companyRuntimeHomeProjectUpdateInputSchema)
          .output(homeProjectSchema)
          .mutation(({ ctx, input }) => ctx.runtime.updateHomeProject({ memberId: input.member_id, projectId: input.project_id, name: input.name })),
        delete: internalProcedure
          .input(companyRuntimeHomeProjectDeleteInputSchema)
          .output(homeProjectDeleteResultSchema)
          .mutation(({ ctx, input }) => ctx.runtime.deleteHomeProject({ memberId: input.member_id, projectId: input.project_id, confirmationName: input.confirmation })),
        thread: t.router({
          move: internalProcedure
            .input(companyRuntimeHomeProjectThreadMoveInputSchema)
            .output(homeProjectThreadMoveResultSchema)
            .mutation(({ ctx, input }) => ctx.runtime.moveHomeThreadToProject({ memberId: input.member_id, threadId: input.thread_id, projectId: input.project_id })),
        }),
      }),
      conversationImport: t.router({
        read: internalProcedure
          .input(companyRuntimeHomeConversationImportReadInputSchema)
          .output(homeConversationImportSchema)
          .query(({ ctx, input }) => ctx.runtime.readHomeConversationImport(input.member_id, input.import_id)),
      }),
      thread: t.router({
        list: internalProcedure
          .input(companyRuntimeHomeThreadListInputSchema)
          .output(homeThreadListResultSchema)
          .query(({ ctx, input }) => ctx.runtime.listHomeThreads({
            memberId: input.member_id,
            projectId: input.project_id,
            cursor: input.cursor,
            limit: input.limit,
            archived: input.archived,
          })),
        delete: internalProcedure
          .input(companyRuntimeHomeThreadDeleteInputSchema)
          .output(homeThreadDeleteResultSchema)
          .mutation(({ ctx, input }) => ctx.runtime.deleteHomeThread({
            memberId: input.member_id,
            threadId: input.thread_id,
            confirmation: input.confirmation,
            expectedRevision: input.expected_revision,
            idempotencyKey: input.idempotency_key,
          })),
        fork: internalProcedure
          .input(companyRuntimeHomeThreadForkInputSchema)
          .output(homeThreadForkResultSchema)
          .mutation(({ ctx, input }) => ctx.runtime.forkHomeThread({
            ...input,
            memberId: input.member_id,
          })),
        search: internalProcedure
          .input(companyRuntimeHomeThreadSearchInputSchema)
          .output(homeThreadSearchResultSchema)
          .query(({ ctx, input }) => ctx.runtime.searchHomeThreads({
            memberId: input.member_id,
            projectId: input.project_id,
            searchTerm: input.search_term,
            cursor: input.cursor,
            limit: input.limit,
            archived: input.archived,
          })),
        read: internalProcedure
          .input(companyRuntimeHomeThreadReadInputSchema)
          .output(homeThreadReadResultSchema)
          .query(({ ctx, input }) => ctx.runtime.readHomeThread(input.member_id, input.thread_id)),
        select: internalProcedure
          .input(companyRuntimeHomeThreadSelectInputSchema)
          .output(homeThreadSelectResultSchema)
          .mutation(({ ctx, input }) => ctx.runtime.selectHomeThread({
            memberId: input.member_id,
            rootThreadId: input.root_thread_id,
            threadId: input.thread_id,
            expectedRevision: input.expected_revision,
            idempotencyKey: input.idempotency_key,
          })),
        settings: t.router({
          get: internalProcedure
            .input(companyRuntimeHomeThreadSettingsInputSchema)
            .output(homeThreadSettingsResultSchema)
            .query(({ ctx, input }) => ctx.runtime.readHomeThreadSettings(input.member_id, input.thread_id)),
          set: internalProcedure
            .input(companyRuntimeHomeThreadSettingsSetInputSchema)
            .output(homeThreadSettingsResultSchema)
            .mutation(({ ctx, input }) => ctx.runtime.updateHomeThreadSettings({
              memberId: input.member_id,
              threadId: input.thread_id,
              model: input.model,
              reasoningEffort: input.reasoning_effort,
            })),
        }),
      }),
      turn: t.router({
        submit: internalProcedure
          .input(companyRuntimeHomeTurnSubmitInputSchema)
          .output(homeTurnSubmitResultSchema)
          .mutation(({ ctx, input }) => ctx.runtime.submitHomeTurn({
            memberId: input.member_id,
            threadId: input.thread_id,
            projectId: input.project_id,
            prompt: input.prompt,
            imageAttachments: input.image_attachments ?? [],
            builderScope: input.builder_scope,
            developerInstructions: input.developer_instructions,
            model: input.model,
            reasoningEffort: input.reasoning_effort,
            clientMessageId: input.client_message_id,
            timeoutMs: input.timeout_ms,
          })),
        events: internalProcedure
          .input(companyRuntimeHomeTurnEventsInputSchema)
          .output(codexAgentRuntimeEventStreamSchema)
          .subscription(({ ctx, input, signal }) => (
            ctx.runtime.homeTurnEventStream(input.member_id, input.thread_id, { signal })
          )),
        allEvents: internalProcedure
          .input(companyRuntimeHomeAllTurnEventsInputSchema)
          .output(codexAgentRuntimeEventStreamSchema)
          .subscription(({ ctx, input, signal }) => ctx.runtime.homeAllTurnEventStream(input.member_id, { signal })),
        respondToQuestion: internalProcedure
          .input(companyRuntimeHomeQuestionInteractionRespondInputSchema)
          .output(homeQuestionInteractionRespondResultSchema)
          .mutation(({ ctx, input }) => ctx.runtime.respondHomeQuestionInteraction(input.member_id, input)),
        snoozeQuestion: internalProcedure
          .input(companyRuntimeHomeQuestionInteractionSnoozeInputSchema)
          .output(homeQuestionInteractionSnoozeResultSchema)
          .mutation(({ ctx, input }) => ctx.runtime.snoozeHomeQuestionInteraction(input.member_id, input)),
      }),
      filesystem: t.router({
        search: internalProcedure
          .input(companyRuntimeHomeFilesystemSearchInputSchema)
          .output(homeFilesystemSearchResultSchema)
          .query(({ ctx, input }) => searchFilesystem({
            workdir: ctx.workdir,
            runtime: ctx.runtime,
            codexFilesystemFactory: ctx.dependencies.codexFilesystemFactory,
            memberId: input.member_id,
            searchTerm: input.search_term,
            cursor: input.cursor,
            limit: input.limit,
          })),
        list: internalProcedure
          .input(companyRuntimeHomeFilesystemListInputSchema)
          .output(homeFilesystemListResultSchema)
          .query(({ ctx, input }) => listDirectory({
            workdir: ctx.workdir,
            runtime: ctx.runtime,
            codexFilesystemFactory: ctx.dependencies.codexFilesystemFactory,
            memberId: input.member_id,
            path: input.path,
          })),
        create: internalProcedure
          .input(companyRuntimeHomeFilesystemCreateInputSchema)
          .output(homeFilesystemEntrySchema)
          .mutation(({ ctx, input }) => createEntry({
            workdir: ctx.workdir,
            runtime: ctx.runtime,
            codexFilesystemFactory: ctx.dependencies.codexFilesystemFactory,
            memberId: input.member_id,
            parentPath: input.parent_path,
            name: input.name,
            kind: input.kind,
          })),
        rename: internalProcedure
          .input(companyRuntimeHomeFilesystemRenameInputSchema)
          .output(homeFilesystemEntrySchema)
          .mutation(({ ctx, input }) => renameEntry({
            workdir: ctx.workdir,
            runtime: ctx.runtime,
            codexFilesystemFactory: ctx.dependencies.codexFilesystemFactory,
            memberId: input.member_id,
            path: input.path,
            name: input.name,
          })),
        delete: internalProcedure
          .input(companyRuntimeHomeFilesystemDeleteInputSchema)
          .output(homeFilesystemDeleteResultSchema)
          .mutation(({ ctx, input }) => deleteEntry({
            workdir: ctx.workdir,
            runtime: ctx.runtime,
            codexFilesystemFactory: ctx.dependencies.codexFilesystemFactory,
            memberId: input.member_id,
            path: input.path,
          })),
        events: internalProcedure
          .input(companyRuntimeHomeFilesystemEventsInputSchema)
          .output(homeFilesystemEventStreamSchema)
          .subscription(({ ctx, input, signal }) => filesystemEvents({
            workdir: ctx.workdir,
            runtime: ctx.runtime,
            codexFilesystemFactory: ctx.dependencies.codexFilesystemFactory,
            memberId: input.member_id,
            path: input.path,
            signal,
          })),
      }),
    }),
    roomSideChat: t.router({
      thread: t.router({
        read: internalProcedure
          .input(companyRuntimeRoomSideChatThreadReadInputSchema)
          .output(homeThreadReadResultSchema)
          .query(({ ctx, input }) => ctx.runtime.readRoomSideChatThread(
            input.member_id,
            input.room_id,
            input.thread_id,
          )),
      }),
      turn: t.router({
        submit: internalProcedure
          .input(companyRuntimeRoomSideChatTurnSubmitInputSchema)
          .output(homeTurnSubmitResultSchema)
          .mutation(({ ctx, input }) => ctx.runtime.submitRoomSideChatTurn({
            memberId: input.member_id,
            roomId: input.room_id,
            threadId: input.thread_id,
            prompt: input.prompt,
            developerInstructions: input.developer_instructions,
            model: input.model,
            reasoningEffort: input.reasoning_effort,
            clientMessageId: input.client_message_id,
            timeoutMs: input.timeout_ms,
          })),
        events: internalProcedure
          .input(companyRuntimeRoomSideChatTurnEventsInputSchema)
          .output(codexAgentRuntimeEventStreamSchema)
          .subscription(({ ctx, input, signal }) => (
            ctx.runtime.roomSideChatTurnEventStream(
              input.member_id,
              input.room_id,
              { signal },
            )
          )),
      }),
    }),
    room: t.router({
      agentExecution: t.router({
        execute: internalProcedure
          .input(companyRuntimeAgentRoomExecuteInputSchema)
          .output(agentRoomExecutionAcceptedSchema)
          .mutation(({ ctx, input }) => {
            ctx.lifecycle.assertCurrentIdentity(input);
            return ctx.agentExecutions.execute(input.dispatch);
          }),
        interaction: t.router({
          respond: internalProcedure
            .input(companyRuntimeAgentRoomInteractionRespondInputSchema)
            .output(agentRoomInteractionResponseAcceptedSchema)
            .mutation(({ ctx, input }) => {
              ctx.lifecycle.assertCurrentIdentity(input);
              return ctx.agentExecutions.respondInteraction(input.interaction_response);
            }),
        }),
      }),
    }),
  });
}

export function createCompanyRuntimeTrpcRouter(): ReturnType<typeof t.router> {
  return buildCompanyRuntimeTrpcRouter();
}

export type CompanyRuntimeTrpcRouter = ReturnType<typeof createCompanyRuntimeTrpcRouter>;
type CompanyRuntimeTrpcRouterImplementation = ReturnType<typeof buildCompanyRuntimeTrpcRouter>;

type CompanyRuntimeRouterContractGate =
  inferRouterInputs<CompanyRuntimeTrpcRouterImplementation> extends inferRouterInputs<CompanyRuntimeContractRouter>
    ? inferRouterOutputs<CompanyRuntimeTrpcRouterImplementation> extends inferRouterOutputs<CompanyRuntimeContractRouter>
      ? true
      : false
    : false;
type AssertCompanyRuntimeRouterContract<T extends true> = T;
type _CompanyRuntimeRouterContractCheck =
  AssertCompanyRuntimeRouterContract<CompanyRuntimeRouterContractGate>;

function memberStatus(member: MemberAppServerRecord): MemberAppServerStatus {
  return {
    member_id: member.memberId,
    state: member.state === "running"
      ? (member.activeExecutionCount > 0 ? "ready" : "idle")
      : member.state,
    executor_id: member.executorId,
    credential_version: member.credentialVersion,
    active_turn_count: member.activeExecutionCount,
    last_active_at_ms: member.lastActivityAtMs,
    idle_deadline_at_ms: member.state === "running"
      ? member.lastActivityAtMs + 1_800_000
      : null,
    plugin: member.plugin ? {
      plugin_id: member.plugin.pluginId,
      plugin_name: member.plugin.pluginName,
      marketplace_name: member.plugin.marketplaceName,
      version: member.plugin.version,
      installed: member.plugin.installed,
      enabled: member.plugin.enabled,
      mcp_server_names: [...member.plugin.mcpServerNames],
    } : null,
    error: member.state === "failed" ? { code: "MEMBER_APP_SERVER_FAILED", retryable: true } : null,
  };
}

function stoppedMemberStatus(memberId: string): MemberAppServerStatus {
  return {
    member_id: memberId,
    state: "stopped",
    executor_id: null,
    credential_version: null,
    active_turn_count: 0,
    last_active_at_ms: null,
    idle_deadline_at_ms: null,
    plugin: null,
    error: null,
  };
}
