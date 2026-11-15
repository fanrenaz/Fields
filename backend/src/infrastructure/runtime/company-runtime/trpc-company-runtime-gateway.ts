import { once } from "node:events";
import { readFile } from "node:fs/promises";
import WebSocket from "ws";

import type {
  HomeFilesystemCreateInput,
  HomeFilesystemDeleteInput,
  HomeFilesystemEventsInput,
  HomeFilesystemListInput,
  HomeFilesystemRenameInput,
  HomeModelOptionsInput,
  HomeProjectCreateInput,
  HomeProjectDeleteInput,
  HomeProjectListInput,
  HomeProjectThreadMoveInput,
  HomeProjectUpdateInput,
  HomeThreadListInput,
  HomeThreadDeleteInput,
  HomeThreadForkInput,
  HomeThreadReadInput,
  HomeThreadSelectInput,
  HomeThreadSearchInput,
  HomeThreadSettingsInput,
  HomeThreadSettingsSetInput,
  HomeTurnEventsInput,
  HomeTurnSubmitInput,
  HomeQuestionInteractionRespondInput,
  HomeQuestionInteractionSnoozeInput,
  HomeConversationImport,
} from "@fields/contracts/public/home";
import type {
  CompanyProxyDisableInput,
  CompanyProxySetInput,
} from "@fields/contracts/public/executor";
import type {
  HomeFilesystemSearchInput,
} from "@fields/contracts/public/search";
import type { CompanyRuntimeRouter } from "@fields/contracts/internal/router/company-runtime";
import type {
  AgentRoomInteractionResponseDispatch,
  AgentRoomExecutionDispatch,
} from "@fields/contracts/internal/agent-room";
import type {
  CompanyExecutorAuthAttemptInput,
  CompanyExecutorAuthStartInput,
  CompanyExecutorCredentialCleanupInput,
  CompanyExecutorCustomApiConfigureInput,
  CompanyExecutorModelCatalogInput,
  CompanyExecutorModelValidationInput,
  CompanyRuntimeIdentity,
  MemberExecutorSwitchInput,
  MemberExecutorSwitchResult,
} from "@fields/contracts/internal/company-runtime";
import { memberExecutorSwitchResultSchema } from "@fields/contracts/internal/company-runtime";
import type {
  RuntimeAssetContentReadInput,
  RuntimeAssetCredentialOperationInput,
  RuntimeAssetCredentialReplaceInput,
  RuntimeAssetDraftReferenceCasInput,
  RuntimeAssetGitImportInput,
  RuntimeAssetMcpStoreInput,
  RuntimeAssetMcpToolCallInput,
  RuntimeAssetMcpToolsListInput,
  RuntimeAssetPublishReferenceInput,
  RuntimeAssetReferenceInput,
  RuntimeAssetValidateInput,
  RuntimeAssetVersionReferenceInput,
  RuntimeAssetWorkspaceZipInput,
  RuntimeAssetZipPackageInput,
  RuntimeMemberAssetApplyInput,
} from "@fields/contracts/internal/asset";
import { assetStoredPackageSchema } from "@fields/contracts/internal/asset";
import type {
  RuntimeMailboxAuthority,
  RuntimeMailboxConnectionOperationInput,
  RuntimeMailboxConnectInput,
  RuntimeMailboxDisconnectInput,
} from "@fields/contracts/internal/mail";
import type {
  MailAttachmentReadInput,
  MailMessageListInput,
  MailMessageReadInput,
  MailMessageSearchInput,
  MailMessageUpdateInput,
  MailSendInput,
} from "@fields/contracts/public/mail";
import {
  createTRPCProxyClient,
  createWSClient,
  httpBatchLink,
  wsLink,
  type TRPCClient,
} from "@trpc/client";

import type {
  PostgresCompanyRuntimeRepository,
} from "../../persistence/postgres/repositories/execution/company-runtime-repository.js";
import { ApplicationError } from "../../../application/platform/errors.js";
import {
  projectCodexHomeTurnEvents,
} from "../codex-activity/codex-home-stream-projector.js";

export class TrpcCompanyRuntimeGateway {
  constructor(
    private readonly runtimes: PostgresCompanyRuntimeRepository,
    private readonly controlTokenFile: string,
    private readonly memberExecutors: {
      readRuntimeStartFacts(input: {
        companyId: string;
        memberId: string;
      }): Promise<{
        executorId: string;
        credentialVersion: number;
        allowedModels: string[];
        modelReasoningEfforts: Record<string, string[]>;
        allowedReasoningEfforts: string[];
        defaultModel: string;
        defaultReasoningEffort: string | null;
        memoryEnabled: boolean;
        memoryManaged: boolean;
      }>;
    },
  ) {}

  async connect(companyId: string, input: RuntimeMailboxConnectInput) {
    return (await this.client(companyId)).mail.connection.connect.mutate(input);
  }

  async finalizeConnection(companyId: string, input: RuntimeMailboxConnectionOperationInput) {
    return (await this.client(companyId)).mail.connection.finalize.mutate(input);
  }

  async rollbackConnection(companyId: string, input: RuntimeMailboxConnectionOperationInput) {
    return (await this.client(companyId)).mail.connection.rollback.mutate(input);
  }

  async disconnect(companyId: string, input: RuntimeMailboxDisconnectInput) {
    return (await this.client(companyId)).mail.connection.disconnect.mutate(input);
  }

  async listFolders(companyId: string, authority: RuntimeMailboxAuthority) {
    return (await this.client(companyId)).mail.folders.list.query({ authority });
  }

  async listMessages(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailMessageListInput, "mailbox_id">,
  ) {
    return (await this.client(companyId)).mail.messages.list.query({
      authority,
      request: input,
    });
  }

  async searchMessages(
    companyId: string,
    authorities: RuntimeMailboxAuthority[],
    input: Omit<MailMessageSearchInput, "mailbox_ids">,
  ) {
    return (await this.client(companyId)).mail.messages.search.query({
      authorities,
      request: input,
    });
  }

  async readMessage(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailMessageReadInput, "mailbox_id">,
  ) {
    return (await this.client(companyId)).mail.messages.read.query({
      authority,
      request: input,
    });
  }

  async sendMessage(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailSendInput, "mailbox_id">,
  ) {
    return (await this.client(companyId)).mail.messages.send.mutate({
      authority,
      request: input,
    });
  }

  async updateMessage(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailMessageUpdateInput, "mailbox_id" | "idempotency_key">,
    operationId: string,
  ) {
    return (await this.client(companyId)).mail.messages.update.mutate({
      authority,
      request: input,
      operation_id: operationId,
    });
  }

  async readAttachment(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailAttachmentReadInput, "mailbox_id">,
  ) {
    return (await this.client(companyId)).mail.attachments.read.query({
      authority,
      request: input,
    });
  }

  async authStart(companyId: string, input: CompanyExecutorAuthStartInput) {
    return (await this.client(companyId)).executor.auth.start.mutate(input);
  }

  async companyProxyStatus(companyId: string) {
    return this.proxyRequest(async () => (await this.client(companyId)).proxy.get.query());
  }

  async setCompanyProxy(companyId: string, input: CompanyProxySetInput) {
    return this.proxyRequest(async () => (await this.client(companyId)).proxy.set.mutate(input));
  }

  async disableCompanyProxy(companyId: string, input: CompanyProxyDisableInput) {
    return this.proxyRequest(async () => (await this.client(companyId)).proxy.disable.mutate(input));
  }

  async openDesktopBrowserTunnel(companyId: string): Promise<WebSocket> {
    const runtime = await this.runtimes.resolveReady(companyId);
    const url = new URL("/internal/desktop-browser/tunnel", runtime.runtimeUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const authorization = await internalControlAuthorization(this.controlTokenFile);
    const socket = new WebSocket(url, { headers: authorization });
    await Promise.race([
      once(socket, "open"),
      once(socket, "error").then(([error]) => Promise.reject(error)),
    ]);
    return socket;
  }

  async assetImportZip(
    companyId: string,
    input: RuntimeAssetZipPackageInput,
    body: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ) {
    const response = await this.fileRequest(
      companyId,
      "/internal/assets/drafts/package",
      {
        method: "POST",
        query: {
          operation_id: input.operation_id,
          request_fingerprint: input.request_fingerprint,
          draft_id: input.draft_id,
          expected_content_sha256: input.expected_content_sha256 ?? "",
          kind: input.kind,
          file_name: input.file_name,
          package_sha256: input.package_sha256,
          package_size_bytes: String(input.package_size_bytes),
        },
        body,
        signal,
      },
    );
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as {
        error?: unknown;
        retryable?: unknown;
      } | null;
      throw new ApplicationError(
        typeof failure?.error === "string"
          ? failure.error
          : "ASSET_RUNTIME_UNAVAILABLE",
        typeof failure?.retryable === "boolean"
          ? failure.retryable
          : response.status >= 500,
      );
    }
    const result = assetStoredPackageSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!result.success) {
      throw new ApplicationError("ASSET_RUNTIME_RESPONSE_INVALID", true);
    }
    return result.data;
  }

  async assetImportGit(companyId: string, input: RuntimeAssetGitImportInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.draft.importGit.mutate(input)
    ));
  }

  async assetImportWorkspaceZip(companyId: string, input: RuntimeAssetWorkspaceZipInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.draft.importWorkspaceZip.mutate(input)
    ));
  }

  async assetStoreMcp(companyId: string, input: RuntimeAssetMcpStoreInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.draft.storeMcp.mutate(input)
    ));
  }

  async assetValidate(companyId: string, input: RuntimeAssetValidateInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.draft.validate.mutate(input)
    ));
  }

  async assetReleaseDraft(companyId: string, input: RuntimeAssetReferenceInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.draft.release.mutate(input)
    ));
  }

  async assetDraftReferenceCas(companyId: string, input: RuntimeAssetDraftReferenceCasInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.draft.referenceCas.mutate(input)
    ));
  }

  async assetPublishReference(companyId: string, input: RuntimeAssetPublishReferenceInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.publishReference.mutate(input)
    ));
  }

  async assetReleaseVersion(companyId: string, input: RuntimeAssetVersionReferenceInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.releaseVersion.mutate(input)
    ));
  }

  async assetContentRead(companyId: string, input: RuntimeAssetContentReadInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.contentRead.query(input)
    ));
  }

  async assetCredentialStage(companyId: string, input: RuntimeAssetCredentialReplaceInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.credentialStage.mutate(input)
    ));
  }

  async assetCredentialCommit(companyId: string, input: RuntimeAssetCredentialOperationInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.credentialCommit.mutate(input)
    ));
  }

  async assetCredentialAbort(companyId: string, input: RuntimeAssetCredentialOperationInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.credentialAbort.mutate(input)
    ));
  }

  async assetMcpToolsList(companyId: string, input: RuntimeAssetMcpToolsListInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.tools.list.query(input)
    ));
  }

  async assetMcpToolCall(companyId: string, input: RuntimeAssetMcpToolCallInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).assets.tools.invoke.mutate(input)
    ));
  }

  async memberAssetsApply(companyId: string, input: RuntimeMemberAssetApplyInput) {
    return this.assetRequest(async () => (
      (await this.client(companyId)).member.assets.applyInstallation.mutate(input)
    ));
  }

  async memberMemoryApply(companyId: string, input: {
    memberId: string;
    operationId: string;
    enabled: boolean;
    previousEnabled: boolean;
  }) {
    const runtime = await this.runtimes.resolveReady(companyId);
    const facts = await this.memberExecutors.readRuntimeStartFacts({
      companyId,
      memberId: input.memberId,
    });
    const client = await this.clientAt(runtime.runtimeUrl);
    await client.member.appServer.start.mutate({
      member_id: input.memberId,
      executor_id: facts.executorId,
      credential_version: facts.credentialVersion,
      memory_enabled: input.previousEnabled,
      memory_managed: true,
      memory_model: facts.defaultModel,
    });
    return client.member.memory.configure.mutate({
      ...runtimeIdentity(runtime),
      member_id: input.memberId,
      operation_id: input.operationId,
      enabled: input.enabled,
      previous_enabled: input.previousEnabled,
      memory_model: facts.defaultModel,
    });
  }

  async authStatus(companyId: string, input: CompanyExecutorAuthAttemptInput) {
    return (await this.client(companyId)).executor.auth.status.query(input);
  }

  async authCancel(companyId: string, input: CompanyExecutorAuthAttemptInput) {
    return (await this.client(companyId)).executor.auth.cancel.mutate(input);
  }

  async cleanupCredential(companyId: string, input: CompanyExecutorCredentialCleanupInput) {
    return (await this.client(companyId)).executor.credential.cleanup.mutate(input);
  }

  async configureCustomCredential(companyId: string, input: CompanyExecutorCustomApiConfigureInput) {
    return (await this.client(companyId)).executor.credential.configureCustom.mutate(input);
  }

  async executorModelCatalog(companyId: string, input: CompanyExecutorModelCatalogInput) {
    return (await this.client(companyId)).executor.models.catalog.query(input);
  }

  async executorModelsValidate(companyId: string, input: CompanyExecutorModelValidationInput) {
    return (await this.client(companyId)).executor.models.validate.mutate(input);
  }

  async switchExecutor(
    companyId: string,
    input: MemberExecutorSwitchInput,
  ): Promise<MemberExecutorSwitchResult> {
    return memberExecutorSwitchResultSchema.parse(
      await (await this.client(companyId)).member.appServer.switchExecutor.mutate(input),
    );
  }

  async stopMemberAppServer(companyId: string, memberId: string) {
    return (await this.client(companyId)).member.appServer.stop.mutate({
      member_id: memberId,
    });
  }

  async cleanupMember(companyId: string, operationId: string, memberId: string) {
    const runtime = await this.runtimes.resolveReady(companyId);
    return (await this.clientAt(runtime.runtimeUrl)).member.cleanup.mutate({
      ...runtimeIdentity(runtime),
      operation_id: operationId,
      member_id: memberId,
    });
  }

  async executeAgentRoom(companyId: string, dispatch: AgentRoomExecutionDispatch) {
    const runtime = await this.runtimes.resolveReady(companyId);
    const policy = await this.memberExecutors.readRuntimeStartFacts({
      companyId,
      memberId: dispatch.agent_member_id,
    });
    await this.startMemberAppServerAt(runtime.runtimeUrl, companyId, dispatch.agent_member_id);
    return (await this.clientAt(runtime.runtimeUrl)).room.agentExecution.execute.mutate({
      ...runtimeIdentity(runtime),
      dispatch: {
        ...dispatch,
        model: policy.defaultModel,
        reasoning_effort: policy.defaultReasoningEffort,
      },
    });
  }

  async respondAgentRoomInteraction(
    companyId: string,
    interactionResponse: AgentRoomInteractionResponseDispatch,
  ) {
    const runtime = await this.runtimes.resolveReady(companyId);
    return (await this.clientAt(runtime.runtimeUrl)).room.agentExecution.interaction.respond.mutate({
      ...runtimeIdentity(runtime),
      interaction_response: interactionResponse,
    });
  }

  async homeThreadList(companyId: string, memberId: string, input: HomeThreadListInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.thread.list.query({ ...input, member_id: memberId });
  }

  async homeProjectList(companyId: string, memberId: string, input: HomeProjectListInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.project.list.query({ ...input, member_id: memberId });
  }

  async homeProjectCreate(companyId: string, memberId: string, input: HomeProjectCreateInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.project.create.mutate({ ...input, member_id: memberId });
  }

  async homeProjectUpdate(companyId: string, memberId: string, input: HomeProjectUpdateInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.project.update.mutate({ ...input, member_id: memberId });
  }

  async homeProjectDelete(companyId: string, memberId: string, input: HomeProjectDeleteInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.project.delete.mutate({ ...input, member_id: memberId });
  }

  async homeProjectThreadMove(companyId: string, memberId: string, input: HomeProjectThreadMoveInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.project.thread.move.mutate({ ...input, member_id: memberId });
  }

  async homeThreadDelete(companyId: string, memberId: string, input: HomeThreadDeleteInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.thread.delete.mutate({ ...input, member_id: memberId });
  }

  async homeThreadFork(companyId: string, memberId: string, input: HomeThreadForkInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.thread.fork.mutate({ ...input, member_id: memberId });
  }

  async homeModelOptions(companyId: string, memberId: string, input: HomeModelOptionsInput) {
    await this.startMemberAppServer(companyId, memberId);
    const [result, policy] = await Promise.all([
      (await this.client(companyId)).home.model.options.query({ ...input, member_id: memberId }),
      this.memberExecutors.readRuntimeStartFacts({ companyId, memberId }),
    ]);
    const allowedModels = new Set(policy.allowedModels);
    const allowedEfforts = new Set(policy.allowedReasoningEfforts);
    return {
      items: result.items.filter((item) => allowedModels.has(item.model)).map((item) => ({
        ...item,
        is_default: item.model === policy.defaultModel,
        default_reasoning_effort: item.model === policy.defaultModel
          ? policy.defaultReasoningEffort
          : item.default_reasoning_effort,
        supported_reasoning_efforts: item.supported_reasoning_efforts.filter((effort) => allowedEfforts.has(effort)),
      })),
      new_thread_default: {
        model: policy.defaultModel,
        reasoning_effort: policy.defaultReasoningEffort,
      },
    };
  }

  async homeThreadSearch(companyId: string, memberId: string, input: HomeThreadSearchInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.thread.search.query({ ...input, member_id: memberId });
  }

  async homeThreadRead(companyId: string, memberId: string, input: HomeThreadReadInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.thread.read.query({ ...input, member_id: memberId });
  }

  async homeThreadSelect(companyId: string, memberId: string, input: HomeThreadSelectInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.thread.select.mutate({ ...input, member_id: memberId });
  }

  async homeThreadSettings(companyId: string, memberId: string, input: HomeThreadSettingsInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.thread.settings.get.query({ ...input, member_id: memberId });
  }

  async homeConversationImportRead(companyId: string, memberId: string, importId: string): Promise<HomeConversationImport> {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.conversationImport.read.query({ member_id: memberId, import_id: importId });
  }

  async setHomeThreadSettings(companyId: string, memberId: string, input: HomeThreadSettingsSetInput) {
    await this.startMemberAppServer(companyId, memberId);
    await this.assertAllowedModelSelection(companyId, memberId, input.model, input.reasoning_effort);
    return (await this.client(companyId)).home.thread.settings.set.mutate({ ...input, member_id: memberId });
  }

  async homeTurnSubmit(
    companyId: string,
    memberId: string,
    input: HomeTurnSubmitInput & {
      builder_scope?: { kind: "agent" | "asset"; topic_id: string };
      developer_instructions?: string;
    },
  ) {
    await this.startMemberAppServer(companyId, memberId);
    const policy = await this.memberExecutors.readRuntimeStartFacts({ companyId, memberId });
    const runtime = await this.client(companyId);
    const existingSettings = input.thread_id
      ? await runtime.home.thread.settings.get.query({
        member_id: memberId,
        thread_id: input.thread_id,
      })
      : null;
    const model = input.model ?? existingSettings?.model ?? policy.defaultModel;
    const effort = input.reasoning_effort !== undefined
      ? input.reasoning_effort
      : existingSettings?.reasoning_effort ?? policy.defaultReasoningEffort;
    try {
      this.assertPolicySelection(policy, model, effort);
    } catch (error) {
      if (existingSettings && input.model === undefined) {
        throw new ApplicationError("EXECUTOR_THREAD_MODEL_SELECTION_REQUIRED", false);
      }
      throw error;
    }
    return runtime.home.turn.submit.mutate({
      ...input,
      model,
      reasoning_effort: effort,
      member_id: memberId,
    });
  }

  async roomSideChatTurnSubmit(
    companyId: string,
    memberId: string,
    input: {
      room_id: string;
      thread_id?: string | null;
      prompt: string;
      client_message_id?: string;
      timeout_ms?: number;
      developer_instructions: string;
    },
  ) {
    await this.startMemberAppServer(companyId, memberId);
    const policy = await this.memberExecutors.readRuntimeStartFacts({ companyId, memberId });
    return (await this.client(companyId)).roomSideChat.turn.submit.mutate({
      ...input,
      model: policy.defaultModel,
      reasoning_effort: policy.defaultReasoningEffort,
      member_id: memberId,
    });
  }

  async roomSideChatThreadRead(
    companyId: string,
    memberId: string,
    roomId: string,
    threadId: string,
  ) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).roomSideChat.thread.read.query({
      member_id: memberId,
      room_id: roomId,
      thread_id: threadId,
    });
  }

  async homeFilesystemList(companyId: string, memberId: string, input: HomeFilesystemListInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.filesystem.list.query({ ...input, member_id: memberId });
  }

  async homeFilesystemSearch(companyId: string, memberId: string, input: HomeFilesystemSearchInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.filesystem.search.query({ ...input, member_id: memberId });
  }

  async homeFilesystemCreate(companyId: string, memberId: string, input: HomeFilesystemCreateInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.filesystem.create.mutate({ ...input, member_id: memberId });
  }

  async homeFilesystemRename(companyId: string, memberId: string, input: HomeFilesystemRenameInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.filesystem.rename.mutate({ ...input, member_id: memberId });
  }

  async homeFilesystemDelete(companyId: string, memberId: string, input: HomeFilesystemDeleteInput) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.filesystem.delete.mutate({ ...input, member_id: memberId });
  }

  async activateMemberAppServer(companyId: string, memberId: string): Promise<void> {
    await this.startMemberAppServer(companyId, memberId);
  }

  async homeFilesystemUpload(
    companyId: string,
    memberId: string,
    input: { parent_path: string; name: string },
    body: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.fileRequest(companyId, "/internal/files/home/upload", {
      method: "POST",
      query: { ...input, member_id: memberId },
      body,
      signal,
    });
  }

  async homeConversationImportUpload(
    companyId: string,
    memberId: string,
    name: string,
    body: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<Response> {
    await this.startMemberAppServer(companyId, memberId);
    return this.fileRequest(companyId, "/internal/home/conversation-imports", {
      method: "POST",
      query: { member_id: memberId, name },
      body,
      signal,
    });
  }

  async homeFilesystemDownload(
    companyId: string,
    memberId: string,
    input: { path: string; disposition: "attachment" | "inline" },
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.fileRequest(companyId, "/internal/files/home/download", {
      method: "GET",
      query: { ...input, member_id: memberId },
      signal,
    });
  }

  watchHomeTurnEvents(
    companyId: string,
    memberId: string,
    input: HomeTurnEventsInput,
    signal?: AbortSignal,
  ): AsyncIterable<unknown> {
    return projectCodexHomeTurnEvents({
      events: this.watch(companyId, signal, (client, callbacks) => (
        client.home.turn.events.subscribe({ ...input, member_id: memberId }, callbacks)
      )),
      memberId,
      threadId: input.thread_id,
    });
  }

  async homeQuestionInteractionRespond(
    companyId: string,
    memberId: string,
    input: HomeQuestionInteractionRespondInput,
  ) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.turn.respondToQuestion.mutate({ ...input, member_id: memberId });
  }

  async homeQuestionInteractionSnooze(
    companyId: string,
    memberId: string,
    input: HomeQuestionInteractionSnoozeInput,
  ) {
    await this.startMemberAppServer(companyId, memberId);
    return (await this.client(companyId)).home.turn.snoozeQuestion.mutate({ ...input, member_id: memberId });
  }

  watchAllHomeTurnEvents(companyId: string, memberId: string, signal?: AbortSignal): AsyncIterable<unknown> {
    return projectCodexHomeTurnEvents({
      events: this.watch(companyId, signal, (client, callbacks) => client.home.turn.allEvents.subscribe({ member_id: memberId }, callbacks)),
      memberId,
    });
  }

  watchRoomSideChatTurnEvents(
    companyId: string,
    memberId: string,
    roomId: string,
    signal?: AbortSignal,
  ): AsyncIterable<unknown> {
    return projectCodexHomeTurnEvents({
      events: this.watch(companyId, signal, (client, callbacks) => (
        client.roomSideChat.turn.events.subscribe({
          member_id: memberId,
          room_id: roomId,
        }, callbacks)
      )),
      memberId,
    });
  }

  watchHomeFilesystemEvents(
    companyId: string,
    memberId: string,
    input: HomeFilesystemEventsInput,
    signal?: AbortSignal,
  ): AsyncIterable<unknown> {
    return this.watch(companyId, signal, (client, callbacks) => (
      client.home.filesystem.events.subscribe({ ...input, member_id: memberId }, callbacks)
    ));
  }

  private async client(companyId: string): Promise<TRPCClient<CompanyRuntimeRouter>> {
    const runtime = await this.runtimes.resolveReady(companyId);
    return this.clientAt(runtime.runtimeUrl);
  }

  private async assetRequest<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      const assetError = (
        error
        && typeof error === "object"
        && "data" in error
        && error.data
        && typeof error.data === "object"
        && "asset_error" in error.data
      ) ? error.data.asset_error : null;
      if (
        assetError
        && typeof assetError === "object"
        && "code" in assetError
        && typeof assetError.code === "string"
        && "retryable" in assetError
        && typeof assetError.retryable === "boolean"
      ) {
        throw new ApplicationError(assetError.code, assetError.retryable);
      }
      throw error;
    }
  }

  private async proxyRequest<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      const proxyError = (
        error
        && typeof error === "object"
        && "data" in error
        && error.data
        && typeof error.data === "object"
        && "proxy_error" in error.data
      ) ? error.data.proxy_error : null;
      if (
        proxyError
        && typeof proxyError === "object"
        && "code" in proxyError
        && typeof proxyError.code === "string"
        && "retryable" in proxyError
        && typeof proxyError.retryable === "boolean"
      ) {
        throw new ApplicationError(proxyError.code, proxyError.retryable);
      }
      throw error;
    }
  }

  private async startMemberAppServer(companyId: string, memberId: string): Promise<void> {
    const runtime = await this.runtimes.resolveReady(companyId);
    await this.startMemberAppServerAt(runtime.runtimeUrl, companyId, memberId);
  }

  private async assertAllowedModelSelection(
    companyId: string,
    memberId: string,
    model: string,
    reasoningEffort: string | null,
  ): Promise<void> {
    this.assertPolicySelection(
      await this.memberExecutors.readRuntimeStartFacts({ companyId, memberId }),
      model,
      reasoningEffort,
    );
  }

  private assertPolicySelection(
    policy: {
      allowedModels: string[];
      allowedReasoningEfforts: string[];
      modelReasoningEfforts: Record<string, string[]>;
    },
    model: string,
    reasoningEffort: string | null,
  ): void {
    if (!policy.allowedModels.includes(model)) {
      throw new ApplicationError("EXECUTOR_MODEL_NOT_ALLOWED", false);
    }
    if (reasoningEffort !== null && !policy.allowedReasoningEfforts.includes(reasoningEffort)) {
      throw new ApplicationError("EXECUTOR_REASONING_EFFORT_NOT_ALLOWED", false);
    }
    if (reasoningEffort !== null && !policy.modelReasoningEfforts[model]?.includes(reasoningEffort)) {
      throw new ApplicationError("EXECUTOR_REASONING_EFFORT_NOT_ALLOWED", false);
    }
  }

  private async startMemberAppServerAt(
    runtimeUrl: string,
    companyId: string,
    memberId: string,
  ): Promise<void> {
    const executor = await this.memberExecutors.readRuntimeStartFacts({ companyId, memberId });
    await (await this.clientAt(runtimeUrl)).member.appServer.start.mutate({
      member_id: memberId,
      executor_id: executor.executorId,
      credential_version: executor.credentialVersion,
      memory_enabled: executor.memoryEnabled,
      memory_managed: executor.memoryManaged,
      memory_model: executor.defaultModel,
    });
  }

  private async clientAt(runtimeUrl: string): Promise<TRPCClient<CompanyRuntimeRouter>> {
    return createTRPCProxyClient<CompanyRuntimeRouter>({
      links: [httpBatchLink({
        url: trpcHttpUrl(runtimeUrl),
        headers: () => internalControlAuthorization(this.controlTokenFile),
      })],
    });
  }

  private async fileRequest(
    companyId: string,
    path: string,
    input: {
      method: "GET" | "POST";
      query: Record<string, string>;
      body?: AsyncIterable<Uint8Array>;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const runtime = await this.runtimes.resolveReady(companyId);
    const url = new URL(path, runtime.runtimeUrl);
    for (const [name, value] of Object.entries(input.query)) {
      url.searchParams.set(name, value);
    }
    const authorization = await internalControlAuthorization(this.controlTokenFile);
    return fetch(url, {
      method: input.method,
      headers: {
        ...authorization,
        ...(input.body ? { "content-type": "application/octet-stream" } : {}),
      },
      ...(input.body
        ? {
          body: input.body,
          duplex: "half",
        }
        : {}),
      signal: input.signal,
    } as RequestInit & { duplex?: "half" });
  }

  private async *watch(
    companyId: string,
    signal: AbortSignal | undefined,
    subscribe: (
      client: TRPCClient<CompanyRuntimeRouter>,
      callbacks: StreamCallbacks,
    ) => RuntimeSubscription,
  ): AsyncGenerator<unknown> {
    const runtime = await this.runtimes.resolveReady(companyId);
    const queue = new AsyncQueue<unknown>();
    const wsClient = createWSClient({
      url: trpcWsUrl(runtime.runtimeUrl),
      connectionParams: () => internalControlAuthorization(this.controlTokenFile),
    });
    const client = createTRPCProxyClient<CompanyRuntimeRouter>({
      links: [wsLink({ client: wsClient })],
    });
    let subscription: RuntimeSubscription | null = null;
    const close = () => {
      subscription?.unsubscribe();
      queue.close();
      void wsClient.close();
    };
    signal?.addEventListener("abort", close, { once: true });
    try {
      subscription = subscribe(client, {
        onData: (value) => queue.push(value),
        onError: (error) => queue.fail(error),
        onComplete: () => queue.close(),
      });
      for await (const value of queue) yield value;
    } finally {
      signal?.removeEventListener("abort", close);
      close();
    }
  }
}

type RuntimeSubscription = { unsubscribe(): void };
type StreamCallbacks = {
  onData(value: unknown): void;
  onError(error: unknown): void;
  onComplete(): void;
};

function runtimeIdentity(runtime: {
  company_id: string;
}): CompanyRuntimeIdentity {
  return {
    company_id: runtime.company_id,
  };
}

async function internalControlAuthorization(path: string): Promise<{ Authorization: string }> {
  if (!path.trim()) throw new Error("Company Runtime control token file is not configured.");
  const token = (await readFile(path, "utf8")).trim();
  if (!token || token.length > 4096 || /[\r\n]/u.test(token)) {
    throw new Error("Company Runtime control token file is invalid.");
  }
  return { Authorization: `Bearer ${token}` };
}

function trpcHttpUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/trpc`;
}

function trpcWsUrl(baseUrl: string): string {
  const url = new URL(trpcHttpUrl(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private notify: (() => void) | null = null;
  private closed = false;
  private error: unknown = null;

  push(value: T): void {
    if (this.closed) return;
    this.values.push(value);
    this.notify?.();
    this.notify = null;
  }

  fail(error: unknown): void {
    this.error = error;
    this.close();
  }

  close(): void {
    this.closed = true;
    this.notify?.();
    this.notify = null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift() as T;
      } else if (this.error !== null) {
        throw this.error;
      } else if (this.closed) {
        return;
      } else {
        await new Promise<void>((resolve) => {
          this.notify = resolve;
        });
      }
    }
  }
}
