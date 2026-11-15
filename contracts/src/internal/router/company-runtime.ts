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
  homeConversationImportSchema,
  homeTurnSubmitResultSchema,
  homeQuestionInteractionRespondResultSchema,
  homeQuestionInteractionSnoozeResultSchema,
} from "../../public/home.js";
import {
  codexAgentRuntimeEventStreamSchema,
} from "../agent-runtime.js";
import {
  homeFilesystemSearchResultSchema,
} from "../../public/search.js";
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
  companyRuntimeHomeConversationImportReadInputSchema,
  companyRuntimeHomeTurnEventsInputSchema,
  companyRuntimeHomeAllTurnEventsInputSchema,
  companyRuntimeHomeTurnSubmitInputSchema,
  companyRuntimeHomeQuestionInteractionRespondInputSchema,
  companyRuntimeHomeQuestionInteractionSnoozeInputSchema,
  companyRuntimeRoomSideChatTurnEventsInputSchema,
  companyRuntimeRoomSideChatTurnSubmitInputSchema,
  companyRuntimeRoomSideChatThreadReadInputSchema,
  companyRuntimeProxyDisableInputSchema,
  companyRuntimeProxySetInputSchema,
  companyRuntimeProxyStatusSchema,
  companyRuntimeMemberCleanupInputSchema,
  companyRuntimeMemberCleanupResultSchema,
  memberAppServerInputSchema,
  memberAppServerStartInputSchema,
  memberAppServerStatusSchema,
  memberAppServerStopResultSchema,
  memberExecutorSwitchInputSchema,
  memberExecutorSwitchResultSchema,
} from "../company-runtime.js";
import {
  agentRoomExecutionAcceptedSchema,
  agentRoomInteractionResponseAcceptedSchema,
} from "../agent-room.js";
import { publicProcedure, router } from "../../router/core.js";
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
  runtimeMemberAssetApplyInputSchema,
  runtimeMemberAssetApplyResultSchema,
  runtimeAssetPublishReferenceInputSchema,
  runtimeAssetReferenceInputSchema,
  runtimeAssetValidateInputSchema,
  runtimeAssetValidateResultSchema,
  runtimeAssetVersionReferenceInputSchema,
  runtimeAssetWorkspaceZipInputSchema,
} from "../asset.js";
import { assetContentSchema } from "../../public/asset.js";
import {
  runtimeMemberMemoryApplyInputSchema,
  runtimeMemberMemoryApplyResultSchema,
} from "../member-memory.js";
import {
  mailAttachmentReadResultSchema,
  mailFolderListResultSchema,
  mailMessagePageSchema,
  mailMessageSchema,
  mailMessageUpdateResultSchema,
  mailSendResultSchema,
} from "../../public/mail.js";
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
} from "../mail.js";

const contractRouterUnavailable = <T>(): T => {
  throw new Error("Company Runtime contract router cannot execute; connect to a Company Runtime");
};

/** Internal control/data-plane topology exposed by the single Company Runtime. */
export const companyRuntimeRouter = router({
  mail: router({
    connection: router({
      connect: publicProcedure.input(runtimeMailboxConnectInputSchema).output(runtimeMailboxConnectResultSchema).mutation(contractRouterUnavailable),
      finalize: publicProcedure.input(runtimeMailboxConnectionOperationInputSchema).output(runtimeMailboxOperationAckSchema).mutation(contractRouterUnavailable),
      rollback: publicProcedure.input(runtimeMailboxConnectionOperationInputSchema).output(runtimeMailboxOperationAckSchema).mutation(contractRouterUnavailable),
      disconnect: publicProcedure.input(runtimeMailboxDisconnectInputSchema).output(runtimeMailboxOperationAckSchema).mutation(contractRouterUnavailable),
    }),
    folders: router({
      list: publicProcedure.input(runtimeMailboxFoldersInputSchema).output(mailFolderListResultSchema).query(contractRouterUnavailable),
    }),
    messages: router({
      list: publicProcedure.input(runtimeMailboxMessageListInputSchema).output(mailMessagePageSchema).query(contractRouterUnavailable),
      search: publicProcedure.input(runtimeMailboxMessageSearchInputSchema).output(mailMessagePageSchema).query(contractRouterUnavailable),
      read: publicProcedure.input(runtimeMailboxMessageReadInputSchema).output(mailMessageSchema).query(contractRouterUnavailable),
      send: publicProcedure.input(runtimeMailboxSendInputSchema).output(mailSendResultSchema).mutation(contractRouterUnavailable),
      update: publicProcedure.input(runtimeMailboxMessageUpdateInputSchema).output(mailMessageUpdateResultSchema).mutation(contractRouterUnavailable),
    }),
    attachments: router({
      read: publicProcedure.input(runtimeMailboxAttachmentReadInputSchema).output(mailAttachmentReadResultSchema).query(contractRouterUnavailable),
      save: publicProcedure.input(runtimeMailboxAttachmentSaveInputSchema).output(runtimeMailboxAttachmentSaveResultSchema).mutation(contractRouterUnavailable),
    }),
  }),
  assets: router({
    draft: router({
      importGit: publicProcedure.input(runtimeAssetGitImportInputSchema).output(assetStoredPackageSchema).mutation(contractRouterUnavailable),
      importWorkspaceZip: publicProcedure.input(runtimeAssetWorkspaceZipInputSchema).output(assetStoredPackageSchema).mutation(contractRouterUnavailable),
      storeMcp: publicProcedure.input(runtimeAssetMcpStoreInputSchema).output(assetStoredPackageSchema).mutation(contractRouterUnavailable),
      validate: publicProcedure.input(runtimeAssetValidateInputSchema).output(runtimeAssetValidateResultSchema).mutation(contractRouterUnavailable),
      release: publicProcedure.input(runtimeAssetReferenceInputSchema).output(runtimeAssetMutationAckSchema).mutation(contractRouterUnavailable),
      referenceCas: publicProcedure.input(runtimeAssetDraftReferenceCasInputSchema).output(runtimeAssetMutationAckSchema).mutation(contractRouterUnavailable),
    }),
    publishReference: publicProcedure.input(runtimeAssetPublishReferenceInputSchema).output(runtimeAssetMutationAckSchema).mutation(contractRouterUnavailable),
    releaseVersion: publicProcedure.input(runtimeAssetVersionReferenceInputSchema).output(runtimeAssetMutationAckSchema).mutation(contractRouterUnavailable),
    contentRead: publicProcedure.input(runtimeAssetContentReadInputSchema).output(assetContentSchema).query(contractRouterUnavailable),
    credentialStage: publicProcedure.input(runtimeAssetCredentialReplaceInputSchema).output(runtimeAssetMutationAckSchema).mutation(contractRouterUnavailable),
    credentialCommit: publicProcedure.input(runtimeAssetCredentialOperationInputSchema).output(runtimeAssetMutationAckSchema).mutation(contractRouterUnavailable),
    credentialAbort: publicProcedure.input(runtimeAssetCredentialOperationInputSchema).output(runtimeAssetMutationAckSchema).mutation(contractRouterUnavailable),
    tools: router({
      list: publicProcedure.input(runtimeAssetMcpToolsListInputSchema).output(runtimeAssetMcpToolsListResultSchema).query(contractRouterUnavailable),
      invoke: publicProcedure.input(runtimeAssetMcpToolCallInputSchema).output(runtimeAssetMcpToolCallResultSchema).mutation(contractRouterUnavailable),
    }),
  }),
  runtime: router({
    health: publicProcedure.output(companyRuntimeHeartbeatInputSchema).query(contractRouterUnavailable),
    status: publicProcedure.output(companyRuntimeHeartbeatInputSchema).query(contractRouterUnavailable),
  }),
  proxy: router({
    get: publicProcedure.output(companyRuntimeProxyStatusSchema).query(contractRouterUnavailable),
    set: publicProcedure.input(companyRuntimeProxySetInputSchema).output(companyRuntimeProxyStatusSchema).mutation(contractRouterUnavailable),
    disable: publicProcedure.input(companyRuntimeProxyDisableInputSchema).output(companyRuntimeProxyStatusSchema).mutation(contractRouterUnavailable),
  }),
  executor: router({
    auth: router({
      start: publicProcedure.input(companyExecutorAuthStartInputSchema).output(companyExecutorAuthStartResultSchema).mutation(contractRouterUnavailable),
      status: publicProcedure.input(companyExecutorAuthAttemptInputSchema).output(companyExecutorAuthStatusResultSchema).query(contractRouterUnavailable),
      cancel: publicProcedure.input(companyExecutorAuthAttemptInputSchema).output(companyExecutorAuthCancelResultSchema).mutation(contractRouterUnavailable),
    }),
    credential: router({
      configureCustom: publicProcedure.input(companyExecutorCustomApiConfigureInputSchema).output(companyExecutorCustomApiConfigureResultSchema).mutation(contractRouterUnavailable),
      cleanup: publicProcedure.input(companyExecutorCredentialCleanupInputSchema).output(companyExecutorCredentialCleanupResultSchema).mutation(contractRouterUnavailable),
    }),
    models: router({
      catalog: publicProcedure.input(companyExecutorModelCatalogInputSchema).output(companyExecutorModelCatalogResultSchema).query(contractRouterUnavailable),
      validate: publicProcedure.input(companyExecutorModelValidationInputSchema).output(companyExecutorModelValidationResultSchema).mutation(contractRouterUnavailable),
    }),
  }),
  member: router({
    memory: router({
      configure: publicProcedure
        .input(runtimeMemberMemoryApplyInputSchema)
        .output(runtimeMemberMemoryApplyResultSchema)
        .mutation(contractRouterUnavailable),
    }),
    assets: router({
      applyInstallation: publicProcedure
        .input(runtimeMemberAssetApplyInputSchema)
        .output(runtimeMemberAssetApplyResultSchema)
        .mutation(contractRouterUnavailable),
    }),
    cleanup: publicProcedure
      .input(companyRuntimeMemberCleanupInputSchema)
      .output(companyRuntimeMemberCleanupResultSchema)
      .mutation(contractRouterUnavailable),
    appServer: router({
      start: publicProcedure.input(memberAppServerStartInputSchema).output(memberAppServerStatusSchema).mutation(contractRouterUnavailable),
      status: publicProcedure.input(memberAppServerInputSchema).output(memberAppServerStatusSchema).query(contractRouterUnavailable),
      stop: publicProcedure.input(memberAppServerInputSchema).output(memberAppServerStopResultSchema).mutation(contractRouterUnavailable),
      switchExecutor: publicProcedure.input(memberExecutorSwitchInputSchema).output(memberExecutorSwitchResultSchema).mutation(contractRouterUnavailable),
    }),
  }),
  home: router({
    conversationImport: router({
      read: publicProcedure.input(companyRuntimeHomeConversationImportReadInputSchema).output(homeConversationImportSchema).query(contractRouterUnavailable),
    }),
    model: router({
      options: publicProcedure.input(companyRuntimeHomeModelOptionsInputSchema).output(homeModelOptionsResultSchema).query(contractRouterUnavailable),
    }),
    project: router({
      list: publicProcedure.input(companyRuntimeHomeProjectListInputSchema).output(homeProjectListResultSchema).query(contractRouterUnavailable),
      create: publicProcedure.input(companyRuntimeHomeProjectCreateInputSchema).output(homeProjectSchema).mutation(contractRouterUnavailable),
      update: publicProcedure.input(companyRuntimeHomeProjectUpdateInputSchema).output(homeProjectSchema).mutation(contractRouterUnavailable),
      delete: publicProcedure.input(companyRuntimeHomeProjectDeleteInputSchema).output(homeProjectDeleteResultSchema).mutation(contractRouterUnavailable),
      thread: router({
        move: publicProcedure.input(companyRuntimeHomeProjectThreadMoveInputSchema).output(homeProjectThreadMoveResultSchema).mutation(contractRouterUnavailable),
      }),
    }),
    thread: router({
      list: publicProcedure.input(companyRuntimeHomeThreadListInputSchema).output(homeThreadListResultSchema).query(contractRouterUnavailable),
      delete: publicProcedure.input(companyRuntimeHomeThreadDeleteInputSchema).output(homeThreadDeleteResultSchema).mutation(contractRouterUnavailable),
      fork: publicProcedure.input(companyRuntimeHomeThreadForkInputSchema).output(homeThreadForkResultSchema).mutation(contractRouterUnavailable),
      search: publicProcedure.input(companyRuntimeHomeThreadSearchInputSchema).output(homeThreadSearchResultSchema).query(contractRouterUnavailable),
      read: publicProcedure.input(companyRuntimeHomeThreadReadInputSchema).output(homeThreadReadResultSchema).query(contractRouterUnavailable),
      select: publicProcedure.input(companyRuntimeHomeThreadSelectInputSchema).output(homeThreadSelectResultSchema).mutation(contractRouterUnavailable),
      settings: router({
        get: publicProcedure.input(companyRuntimeHomeThreadSettingsInputSchema).output(homeThreadSettingsResultSchema).query(contractRouterUnavailable),
        set: publicProcedure.input(companyRuntimeHomeThreadSettingsSetInputSchema).output(homeThreadSettingsResultSchema).mutation(contractRouterUnavailable),
      }),
    }),
    turn: router({
      submit: publicProcedure.input(companyRuntimeHomeTurnSubmitInputSchema).output(homeTurnSubmitResultSchema).mutation(contractRouterUnavailable),
      events: publicProcedure.input(companyRuntimeHomeTurnEventsInputSchema).output(codexAgentRuntimeEventStreamSchema).subscription(contractRouterUnavailable),
      allEvents: publicProcedure.input(companyRuntimeHomeAllTurnEventsInputSchema).output(codexAgentRuntimeEventStreamSchema).subscription(contractRouterUnavailable),
      respondToQuestion: publicProcedure
        .input(companyRuntimeHomeQuestionInteractionRespondInputSchema)
        .output(homeQuestionInteractionRespondResultSchema)
        .mutation(contractRouterUnavailable),
      snoozeQuestion: publicProcedure
        .input(companyRuntimeHomeQuestionInteractionSnoozeInputSchema)
        .output(homeQuestionInteractionSnoozeResultSchema)
        .mutation(contractRouterUnavailable),
    }),
    filesystem: router({
      search: publicProcedure.input(companyRuntimeHomeFilesystemSearchInputSchema).output(homeFilesystemSearchResultSchema).query(contractRouterUnavailable),
      list: publicProcedure.input(companyRuntimeHomeFilesystemListInputSchema).output(homeFilesystemListResultSchema).query(contractRouterUnavailable),
      create: publicProcedure.input(companyRuntimeHomeFilesystemCreateInputSchema).output(homeFilesystemEntrySchema).mutation(contractRouterUnavailable),
      rename: publicProcedure.input(companyRuntimeHomeFilesystemRenameInputSchema).output(homeFilesystemEntrySchema).mutation(contractRouterUnavailable),
      delete: publicProcedure.input(companyRuntimeHomeFilesystemDeleteInputSchema).output(homeFilesystemDeleteResultSchema).mutation(contractRouterUnavailable),
      events: publicProcedure.input(companyRuntimeHomeFilesystemEventsInputSchema).output(homeFilesystemEventStreamSchema).subscription(contractRouterUnavailable),
    }),
  }),
  roomSideChat: router({
    thread: router({
      read: publicProcedure.input(companyRuntimeRoomSideChatThreadReadInputSchema).output(homeThreadReadResultSchema).query(contractRouterUnavailable),
    }),
    turn: router({
      submit: publicProcedure.input(companyRuntimeRoomSideChatTurnSubmitInputSchema).output(homeTurnSubmitResultSchema).mutation(contractRouterUnavailable),
      events: publicProcedure.input(companyRuntimeRoomSideChatTurnEventsInputSchema).output(codexAgentRuntimeEventStreamSchema).subscription(contractRouterUnavailable),
    }),
  }),
  room: router({
    agentExecution: router({
      execute: publicProcedure.input(companyRuntimeAgentRoomExecuteInputSchema).output(agentRoomExecutionAcceptedSchema).mutation(contractRouterUnavailable),
      interaction: router({
        respond: publicProcedure
          .input(companyRuntimeAgentRoomInteractionRespondInputSchema)
          .output(agentRoomInteractionResponseAcceptedSchema)
          .mutation(contractRouterUnavailable),
      }),
    }),
  }),
});

export type CompanyRuntimeRouter = typeof companyRuntimeRouter;
