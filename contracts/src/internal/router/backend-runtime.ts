import { roomCodexAgentRuntimeActivityAcceptedSchema } from "../agent-runtime.js";
import { homeTerminalNotificationInputSchema, homeTerminalNotificationResultSchema } from "../notification.js";
import {
  companyExecutorCredentialUpdatedInputSchema,
  companyExecutorUnavailableInputSchema,
  companyRuntimeAgentActivityInputSchema,
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
} from "../company-runtime.js";
import { publicProcedure, router } from "../../router/core.js";
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
  runtimeMemberAssetOperationCompletedInputSchema,
  runtimeAgentMemberAssetApplyInputSchema,
  runtimeAgentMemberAssetCurrentInputSchema,
  runtimeAgentMemberAssetOptionsInputSchema,
  runtimeAgentMemberAssetOptionsResultSchema,
  runtimeAgentMemberAssetProfileResultSchema,
} from "../asset.js";
import {
  runtimeMemberMailboxListInputSchema,
  runtimeMemberMailboxListResultSchema,
  runtimeMailboxAuditInputSchema,
  runtimeMailboxOperationAckSchema,
} from "../mail.js";
import { companyFileUploadReservationSchema } from "../../public/company-file.js";
import {
  runtimeMemberMemoryCompletedInputSchema,
} from "../member-memory.js";

const contractRouterUnavailable = <T>(): T => {
  throw new Error("Backend runtime contract router cannot execute; connect to the Backend runtime");
};

/** Bearer-authenticated callbacks accepted only from the configured Company Runtime. */
export const backendRuntimeRouter = router({
  companyRuntime: router({
    notifications: router({
      homeTerminal: publicProcedure.input(homeTerminalNotificationInputSchema).output(homeTerminalNotificationResultSchema).mutation(contractRouterUnavailable),
    }),
    memory: router({
      completed: publicProcedure
        .input(runtimeMemberMemoryCompletedInputSchema)
        .mutation(contractRouterUnavailable),
    }),
    mail: router({
      mailboxes: publicProcedure
        .input(runtimeMemberMailboxListInputSchema)
        .output(runtimeMemberMailboxListResultSchema)
        .query(contractRouterUnavailable),
      audit: publicProcedure
        .input(runtimeMailboxAuditInputSchema)
        .output(runtimeMailboxOperationAckSchema)
        .mutation(contractRouterUnavailable),
    }),
    assets: router({
      installations: router({
        current: publicProcedure
          .input(runtimeAgentMemberAssetCurrentInputSchema)
          .output(runtimeAgentMemberAssetProfileResultSchema)
          .query(contractRouterUnavailable),
        options: publicProcedure
          .input(runtimeAgentMemberAssetOptionsInputSchema)
          .output(runtimeAgentMemberAssetOptionsResultSchema)
          .query(contractRouterUnavailable),
        applyInstallation: publicProcedure
          .input(runtimeAgentMemberAssetApplyInputSchema)
          .output(runtimeAgentMemberAssetProfileResultSchema)
          .mutation(contractRouterUnavailable),
      }),
      installationCompleted: publicProcedure
        .input(runtimeMemberAssetOperationCompletedInputSchema)
        .mutation(contractRouterUnavailable),
      list: publicProcedure.input(runtimeAgentAssetListInputSchema).output(runtimeAgentAssetListResultSchema).query(contractRouterUnavailable),
      read: publicProcedure.input(runtimeAgentAssetReadInputSchema).output(runtimeAgentAssetDetailResultSchema).query(contractRouterUnavailable),
      contentRead: publicProcedure.input(runtimeAgentAssetContentReadInputSchema).output(runtimeAgentAssetContentResultSchema).query(contractRouterUnavailable),
      draft: router({
        beginZip: publicProcedure.input(runtimeAgentAssetBeginZipInputSchema).output(runtimeAgentAssetDraftMutationResultSchema).mutation(contractRouterUnavailable),
        importGit: publicProcedure.input(runtimeAgentAssetImportGitInputSchema).output(runtimeAgentAssetDraftMutationResultSchema).mutation(contractRouterUnavailable),
        importWorkspaceZip: publicProcedure.input(runtimeAgentAssetImportWorkspaceZipInputSchema).output(runtimeAgentAssetDraftMutationResultSchema).mutation(contractRouterUnavailable),
        createMcp: publicProcedure.input(runtimeAgentAssetCreateMcpInputSchema).output(runtimeAgentAssetDraftMutationResultSchema).mutation(contractRouterUnavailable),
        update: publicProcedure.input(runtimeAgentAssetUpdateInputSchema).output(runtimeAgentAssetDraftMutationResultSchema).mutation(contractRouterUnavailable),
        validate: publicProcedure.input(runtimeAgentAssetRevisionInputSchema).output(runtimeAgentAssetDraftMutationResultSchema).mutation(contractRouterUnavailable),
        delete: publicProcedure.input(runtimeAgentAssetRevisionInputSchema).output(runtimeAgentAssetDraftDeleteResultSchema).mutation(contractRouterUnavailable),
      }),
      publish: publicProcedure.input(runtimeAgentAssetRevisionInputSchema).output(runtimeAgentAssetPublishResultSchema).mutation(contractRouterUnavailable),
      archive: publicProcedure.input(runtimeAgentAssetArchiveInputSchema).output(runtimeAgentAssetMutationResultSchema).mutation(contractRouterUnavailable),
      restore: publicProcedure.input(runtimeAgentAssetArchiveInputSchema).output(runtimeAgentAssetMutationResultSchema).mutation(contractRouterUnavailable),
      credentialReplace: publicProcedure.input(runtimeAgentAssetCredentialReplaceInputSchema).output(runtimeAgentAssetMutationResultSchema).mutation(contractRouterUnavailable),
    }),
    ready: publicProcedure.input(companyRuntimeIdentitySchema).mutation(contractRouterUnavailable),
    heartbeat: publicProcedure.input(companyRuntimeHeartbeatInputSchema).mutation(contractRouterUnavailable),
    failed: publicProcedure.input(companyRuntimeFailedInputSchema).mutation(contractRouterUnavailable),
    executor: router({
      credentialUpdated: publicProcedure.input(companyExecutorCredentialUpdatedInputSchema).mutation(contractRouterUnavailable),
      unavailable: publicProcedure.input(companyExecutorUnavailableInputSchema).mutation(contractRouterUnavailable),
    }),
    agentExecution: router({
      activity: publicProcedure
        .input(companyRuntimeAgentActivityInputSchema)
        .output(roomCodexAgentRuntimeActivityAcceptedSchema)
        .mutation(contractRouterUnavailable),
      progress: publicProcedure.input(companyRuntimeAgentExecutionProgressInputSchema).mutation(contractRouterUnavailable),
      complete: publicProcedure.input(companyRuntimeAgentExecutionCompletionInputSchema).mutation(contractRouterUnavailable),
    }),
    roomMessages: router({
      read: publicProcedure
        .input(companyRuntimeRoomMessagesReadInputSchema)
        .output(companyRuntimeRoomMessagesReadResultSchema)
        .query(contractRouterUnavailable),
    }),
    search: router({
      query: publicProcedure
        .input(companyRuntimeSearchQueryInputSchema)
        .output(companyRuntimeSearchQueryResultSchema)
        .query(contractRouterUnavailable),
    }),
    files: router({
      list: publicProcedure
        .input(companyRuntimeFileListInputSchema)
        .output(companyRuntimeFileListResultSchema)
        .query(contractRouterUnavailable),
      read: publicProcedure
        .input(companyRuntimeFileReadInputSchema)
        .output(companyRuntimeFileReadResultSchema)
        .query(contractRouterUnavailable),
      upload: router({
        begin: publicProcedure
          .input(companyRuntimeFileUploadBeginInputSchema)
          .output(companyFileUploadReservationSchema)
          .mutation(contractRouterUnavailable),
        finalize: publicProcedure
          .input(companyRuntimeFileUploadFinalizeInputSchema)
          .output(companyRuntimeFileUploadResultSchema)
          .mutation(contractRouterUnavailable),
      }),
    }),
  }),
});

export type BackendRuntimeRouter = typeof backendRuntimeRouter;
