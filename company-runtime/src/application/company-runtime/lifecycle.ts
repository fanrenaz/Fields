import type {
  CompanyRuntimeHeartbeatInput,
  CompanyRuntimeIdentity,
  CompanyRuntimeInitInput,
  CompanyRuntimeInitResult,
  CompanyRuntimeRoomMessagesReadInput,
  CompanyRuntimeRoomMessagesReadResult,
  CompanyRuntimeSearchQueryResult,
  MemberAppServerStatus,
} from "@fields/contracts/internal/company-runtime";
import type { GlobalSearchInput } from "@fields/contracts/public/search";
import type { MailMailboxListResult } from "@fields/contracts/public/mail";
import type { RuntimeMailboxAuditInput } from "@fields/contracts/internal/mail";
import type { HomeTerminalNotificationInput } from "@fields/contracts/internal/notification";
import type {
  AssetArchiveInput,
  AssetContentReadInput,
  AssetDraftCreateMcpInput,
  AssetDraftImportGitInput,
  AssetDraftRevisionInput,
  AssetDraftUpdateInput,
  AssetListInput,
  AssetMcpCredentialReplaceInput,
  AssetReadInput,
  SelfMemberAssetApplyInput,
} from "@fields/contracts/public/asset";
import {
  COMPANY_FILE_MAX_BYTES,
  type CompanyFile,
  type CompanyFileListInput,
  type CompanyFileListResult,
} from "@fields/contracts/public/company-file";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { MemberAssetCompletion } from "../member-assets/service.js";
import type { MemberMemoryCompletion } from "../member-memory/capability.js";
type AssetWorkspaceZipBaseInput = {
  name: string;
  slug: string;
  description?: string;
  thread_id: string;
  workspace_relative_path: string;
  idempotency_key: string;
};

type AssetWorkspaceZipInput =
  | AssetWorkspaceZipBaseInput & {
    kind: "plugin";
    version?: null;
  }
  | AssetWorkspaceZipBaseInput & {
    kind: "skill";
    version: string;
  };
import type {
  RoomCodexAgentRuntimeActivityAccepted,
  RoomCodexAgentRuntimeEnvelope,
} from "@fields/contracts/internal/agent-runtime";
import type {
  AgentRoomExecutionCompletion,
  AgentRoomExecutionProgress,
} from "@fields/contracts/internal/agent-room";

import type {
  MemberAppServerRecord,
  MemberRuntimeManager,
} from "../member-runtime/manager.js";
import type {
  CompanyExecutorConnected,
  CompanyExecutorUnavailable,
} from "../company-executor/service.js";
import {
  createBackendRuntimeClient,
  type BackendRuntimeClient,
  type BackendRuntimeClientFactory,
} from "./backend-client.js";
import { CompanyFileCache, type MaterializedCompanyFile } from "./company-file-cache.js";
import { emitLifecycleEvent } from "../../observability/events.js";

const HEARTBEAT_INTERVAL_MS = 10_000;
const STORAGE_POLICY: CompanyRuntimeInitInput["storage_policy"] = {
  member_workspace_pattern: "members/<member_id>/workspace",
  codex_home_directory: ".codex",
  room_file_inputs: "execution_scoped_company_file_snapshots",
  executor_credentials_pattern: "executors/<executor_id>/credentials",
  codex_home_auth_json: "forbidden",
  codex_home_visibility: "excluded_from_files_search_upload_export_git",
};
const EXECUTION_POLICY: CompanyRuntimeInitInput["execution_policy"] = {
  idle_timeout_ms: 1_800_000,
  same_agent_room_thread: "serial",
  different_room_threads: "parallel",
  thread_recovery: "resume",
  executor_auth: "chatgptAuthTokens",
};

export type CompanyRuntimeLifecycleOptions = {
  clientFactory?: BackendRuntimeClientFactory;
  nowMs?: () => number;
  setInterval?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
};

export type CompanyRuntimeBackendConnection = {
  apiUrl: string;
  callbackToken: string;
  identity: CompanyRuntimeIdentity;
};

export class CompanyRuntimeConfigurationError extends Error {
  readonly code = "company_runtime_configuration_invalid";
}

export class CompanyRuntimeLifecycle {
  private readonly identity: CompanyRuntimeIdentity;
  private readonly layout: CompanyRuntimeInitInput["layout"];
  private readonly runtime: MemberRuntimeManager;
  private readonly options: CompanyRuntimeLifecycleOptions;
  private readonly companyFileCache: CompanyFileCache;
  private initInput: CompanyRuntimeInitInput | null = null;
  private client: BackendRuntimeClient | null = null;
  private state: CompanyRuntimeHeartbeatInput["state"] = "starting";
  private initialized = false;
  private initializationFlight: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatFlights = new Set<Promise<void>>();
  private closing = false;

  constructor(
    identity: CompanyRuntimeIdentity,
    layout: CompanyRuntimeInitInput["layout"],
    runtime: MemberRuntimeManager,
    options: CompanyRuntimeLifecycleOptions = {},
  ) {
    this.identity = identity;
    this.layout = layout;
    this.runtime = runtime;
    this.options = options;
    this.companyFileCache = new CompanyFileCache(layout.members_root);
  }

  async initialize(input: CompanyRuntimeInitInput): Promise<CompanyRuntimeInitResult> {
    this.assertInitMatches(input);
    if (this.closing) {
      throw new CompanyRuntimeConfigurationError("Company Runtime is stopping.");
    }
    if (this.initInput) {
      if (
        this.initInput.backend_callback_url !== input.backend_callback_url
        || this.initInput.runtime_callback_token !== input.runtime_callback_token
      ) {
        throw new CompanyRuntimeConfigurationError("Company Runtime is already initialized with a different callback.");
      }
    } else {
      this.initInput = input;
      this.client = (this.options.clientFactory ?? createBackendRuntimeClient)(
        input.backend_callback_url,
        { token: input.runtime_callback_token },
      );
      this.state = "ready";
      this.runtime.start();
    }
    if (!this.initialized) {
      const flight = this.initializationFlight ?? this.completeInitialization();
      this.initializationFlight = flight;
      try {
        await flight;
      } finally {
        if (this.initializationFlight === flight) this.initializationFlight = null;
      }
    }
    return {
      ...this.identity,
      initialized: true,
      layout: this.layout,
      storage_policy: STORAGE_POLICY,
      execution_policy: EXECUTION_POLICY,
    };
  }

  status(): CompanyRuntimeHeartbeatInput {
    const members = this.runtime.listMemberAppServers().map((member) => (
      memberStatus(member, this.initInput?.execution_policy.idle_timeout_ms ?? EXECUTION_POLICY.idle_timeout_ms)
    ));
    const degraded = members.some((member) => member.state === "failed");
    return {
      ...this.identity,
      state: this.state === "ready" && degraded ? "degraded" : this.state,
      member_app_servers: members,
      active_execution_count: members.reduce((total, member) => total + member.active_turn_count, 0),
      occurred_at_ms: this.nowMs(),
    };
  }

  isReady(): boolean {
    return this.initialized && (this.state === "ready" || this.state === "degraded");
  }

  backendConnection(): CompanyRuntimeBackendConnection {
    if (!this.initInput) {
      throw new CompanyRuntimeConfigurationError("Company Runtime has not been initialized.");
    }
    return {
      apiUrl: this.initInput.backend_callback_url,
      callbackToken: this.initInput.runtime_callback_token,
      identity: this.identity,
    };
  }

  assertCurrentIdentity(candidate: CompanyRuntimeIdentity): void {
    if (candidate.company_id !== this.identity.company_id) {
      throw new CompanyRuntimeConfigurationError("Company Runtime company_id is stale.");
    }
  }

  async heartbeat(): Promise<void> {
    if (!this.client || this.closing) return;
    await this.runtime.verifyMemberPlugins();
    const flight = this.client.companyRuntime.heartbeat.mutate(this.status()).then(() => undefined);
    this.heartbeatFlights.add(flight);
    try {
      await flight;
    } finally {
      this.heartbeatFlights.delete(flight);
    }
  }

  async executorConnected(connected: CompanyExecutorConnected): Promise<void> {
    if (!this.client) return;
    await this.client.companyRuntime.executor.credentialUpdated.mutate({
      ...this.identity,
      executor_id: connected.executorId,
      credential_version: connected.credentialVersion,
      authorization: connected.authorization.method === "chatgpt"
        ? {
          method: "chatgpt",
          account_id: connected.authorization.accountId,
          plan_type: connected.authorization.planType,
        }
        : {
          method: "custom_api_key",
          endpoint_host: connected.authorization.endpointHost,
        },
      occurred_at_ms: this.nowMs(),
    });
  }

  async executorUnavailable(unavailable: CompanyExecutorUnavailable): Promise<void> {
    if (!this.client) return;
    await this.client.companyRuntime.executor.unavailable.mutate({
      ...this.identity,
      executor_id: unavailable.executorId,
      credential_version: unavailable.credentialVersion
        ?? this.executorCredentialVersion(unavailable.executorId),
      reason: unavailableReason(unavailable.code, unavailable.status),
      occurred_at_ms: this.nowMs(),
    });
  }

  async executionProgress(progress: AgentRoomExecutionProgress): Promise<void> {
    await this.requireClient().companyRuntime.agentExecution.progress.mutate({
      ...this.identity,
      progress,
    });
  }

  async agentActivity(
    event: RoomCodexAgentRuntimeEnvelope,
  ): Promise<RoomCodexAgentRuntimeActivityAccepted> {
    return this.requireClient().companyRuntime.agentExecution.activity.mutate({
      ...this.identity,
      event,
    });
  }

  async homeTerminalNotification(
    event: Omit<HomeTerminalNotificationInput, "identity">,
  ): Promise<{ accepted: true; activity_id: string }> {
    return this.requireClient().companyRuntime.notifications.homeTerminal.mutate({
      identity: this.identity,
      ...event,
    });
  }

  async executionComplete(completion: AgentRoomExecutionCompletion): Promise<void> {
    await this.requireClient().companyRuntime.agentExecution.complete.mutate({
      ...this.identity,
      completion,
    });
  }

  async readRoomMessages(
    memberId: string,
    roomId: string,
    accessMode: CompanyRuntimeRoomMessagesReadInput["access_mode"],
    resource: CompanyRuntimeRoomMessagesReadInput["resource"],
  ): Promise<CompanyRuntimeRoomMessagesReadResult> {
    return this.requireClient().companyRuntime.roomMessages.read.query({
      ...this.identity,
      member_id: memberId,
      room_id: roomId,
      access_mode: accessMode,
      resource,
    });
  }

  async search(
    memberId: string,
    query: GlobalSearchInput,
  ): Promise<CompanyRuntimeSearchQueryResult> {
    return this.requireClient().companyRuntime.search.query.query({
      ...this.identity,
      member_id: memberId,
      query,
    });
  }

  async fileList(memberId: string, input: CompanyFileListInput): Promise<CompanyFileListResult> {
    return this.requireClient().companyRuntime.files.list.query({
      ...this.identity,
      member_id: memberId,
      input,
    });
  }

  async fileRead(
    memberId: string,
    input: { file_id: string; version_id?: string },
  ): Promise<MaterializedCompanyFile> {
    try {
      const source = await this.requireClient().companyRuntime.files.read.query({
        ...this.identity,
        member_id: memberId,
        input,
      });
      const materialized = await this.companyFileCache.read(memberId, source);
      emitLifecycleEvent("company_files.cache.read", {
        result: "succeeded",
        retryable: false,
        "fields.actor_id": memberId,
        "fields.file_id": materialized.file_id,
        "fields.version_id": materialized.version_id,
        "fields.byte_count": materialized.size_bytes,
      });
      return materialized;
    } catch (error) {
      emitLifecycleEvent("company_files.cache.read", {
        result: "failed",
        retryable: false,
        code: "company_file_read_failed",
        "fields.actor_id": memberId,
        "fields.file_id": input.file_id,
      });
      throw error;
    }
  }

  async filePublishWorkspace(memberId: string, input: {
    workspace_relative_path: string;
    file_id?: string;
    expected_revision?: number;
    folder_id: string | null;
    name?: string;
    idempotency_key: string;
  }): Promise<CompanyFile> {
    const relativePath = input.workspace_relative_path.trim();
    if (!relativePath || isAbsolute(relativePath)) {
      throw new CompanyRuntimeConfigurationError("Company File path must be relative to the Member Workspace.");
    }
    const workspace = resolve(this.layout.members_root, memberId, "workspace");
    const candidate = resolve(workspace, relativePath);
    const withinWorkspace = relative(workspace, candidate);
    if (!withinWorkspace || withinWorkspace.startsWith("..") || isAbsolute(withinWorkspace)) {
      throw new CompanyRuntimeConfigurationError("Company File path escapes the Member Workspace.");
    }
    const [workspaceReal, candidateReal, metadata] = await Promise.all([
      realpath(workspace),
      realpath(candidate),
      lstat(candidate),
    ]);
    const realRelative = relative(workspaceReal, candidateReal);
    if (
      !realRelative
      || realRelative.startsWith("..")
      || isAbsolute(realRelative)
      || !metadata.isFile()
      || metadata.isSymbolicLink()
      || metadata.size < 1
      || metadata.size > COMPANY_FILE_MAX_BYTES
    ) {
      throw new CompanyRuntimeConfigurationError("Company File source must be a regular Workspace file up to 25 MB.");
    }
    const body = await readFile(candidateReal);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const upload = await this.requireClient().companyRuntime.files.upload.begin.mutate({
      ...this.identity,
      member_id: memberId,
      input: {
        ...(input.file_id ? {
          file_id: input.file_id,
          expected_revision: input.expected_revision,
        } : {}),
        folder_id: input.folder_id,
        name: input.name?.trim() || basename(candidateReal),
        mime_type: "application/octet-stream",
        size_bytes: body.byteLength,
        sha256,
        idempotency_key: input.idempotency_key,
      },
    });
    if (upload.upload_required) {
      if (!upload.upload_url) {
        throw new CompanyRuntimeConfigurationError("Company File upload URL is unavailable.");
      }
      const response = await fetch(upload.upload_url, {
        method: "PUT",
        headers: upload.upload_headers,
        body,
      });
      if (!response.ok) {
        throw new CompanyRuntimeConfigurationError(`Company File upload failed with HTTP ${response.status}.`);
      }
    }
    return this.requireClient().companyRuntime.files.upload.finalize.mutate({
      ...this.identity,
      member_id: memberId,
      input: {
        upload_id: upload.upload_id,
        idempotency_key: input.idempotency_key,
      },
    });
  }

  async mailListMailboxes(memberId: string): Promise<MailMailboxListResult> {
    return this.requireClient().companyRuntime.mail.mailboxes.query({
      identity: this.identity,
      member_id: memberId,
    });
  }

  async mailAudit(
    input: Omit<RuntimeMailboxAuditInput, "identity">,
  ): Promise<{ ok: true }> {
    return this.requireClient().companyRuntime.mail.audit.mutate({
      ...input,
      identity: this.identity,
    });
  }

  async assetList(memberId: string, input: AssetListInput) {
    return this.requireClient().companyRuntime.assets.list.query({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetRead(memberId: string, input: AssetReadInput) {
    return this.requireClient().companyRuntime.assets.read.query({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetContentRead(memberId: string, input: AssetContentReadInput) {
    return this.requireClient().companyRuntime.assets.contentRead.query({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetImportGit(memberId: string, input: AssetDraftImportGitInput) {
    return this.requireClient().companyRuntime.assets.draft.importGit.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetImportWorkspaceZip(memberId: string, input: AssetWorkspaceZipInput) {
    return this.requireClient().companyRuntime.assets.draft.importWorkspaceZip.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetCreateMcp(memberId: string, input: AssetDraftCreateMcpInput) {
    return this.requireClient().companyRuntime.assets.draft.createMcp.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetUpdateDraft(memberId: string, input: AssetDraftUpdateInput) {
    return this.requireClient().companyRuntime.assets.draft.update.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetValidateDraft(memberId: string, input: AssetDraftRevisionInput) {
    return this.requireClient().companyRuntime.assets.draft.validate.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetDeleteDraft(memberId: string, input: AssetDraftRevisionInput) {
    return this.requireClient().companyRuntime.assets.draft.delete.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetPublish(memberId: string, input: AssetDraftRevisionInput) {
    return this.requireClient().companyRuntime.assets.publish.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetArchive(memberId: string, input: AssetArchiveInput) {
    return this.requireClient().companyRuntime.assets.archive.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetRestore(memberId: string, input: AssetArchiveInput) {
    return this.requireClient().companyRuntime.assets.restore.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async assetReplaceCredential(memberId: string, input: AssetMcpCredentialReplaceInput) {
    return this.requireClient().companyRuntime.assets.credentialReplace.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async memberAssetCurrent(memberId: string) {
    return this.requireClient().companyRuntime.assets.installations.current.query({
      identity: this.identity,
      member_id: memberId,
      input: {},
    });
  }

  async memberAssetOptions(
    memberId: string,
    input: { kind?: "plugin" | "skill" | "mcp"; search_term?: string },
  ) {
    return this.requireClient().companyRuntime.assets.installations.options.query({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async memberAssetApply(memberId: string, input: SelfMemberAssetApplyInput) {
    return this.requireClient().companyRuntime.assets.installations.applyInstallation.mutate({
      identity: this.identity,
      member_id: memberId,
      input,
    });
  }

  async memberAssetCompleted(input: MemberAssetCompletion): Promise<void> {
    await this.requireClient().companyRuntime.assets.installationCompleted.mutate({
      identity: this.identity,
      member_id: input.memberId,
      operation_id: input.operationId,
      requested_revision: input.requestedRevision,
      status: input.status,
      installations: input.installations,
      error_code: input.errorCode,
      retryable: input.retryable,
      completed_at_ms: input.completedAtMs,
    });
  }

  async memberMemoryCompleted(input: MemberMemoryCompletion): Promise<void> {
    await this.requireClient().companyRuntime.memory.completed.mutate({
      identity: this.identity,
      member_id: input.memberId,
      operation_id: input.operationId,
      applied_enabled: input.appliedEnabled,
      status: input.status,
      error_code: input.errorCode,
      completed_at_ms: input.completedAtMs,
    });
  }

  async failed(code: string, retryable: boolean): Promise<void> {
    this.state = "failed";
    if (!this.client) return;
    await this.client.companyRuntime.failed.mutate({
      ...this.identity,
      error: { code, retryable },
      occurred_at_ms: this.nowMs(),
    });
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    this.state = "stopping";
    if (this.heartbeatTimer !== null) {
      (this.options.clearInterval ?? clearInterval)(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await Promise.allSettled([...this.heartbeatFlights]);
  }

  private async completeInitialization(): Promise<void> {
    await this.requireClient().companyRuntime.ready.mutate(this.identity);
    await this.heartbeat();
    if (this.closing) {
      throw new CompanyRuntimeConfigurationError("Company Runtime is stopping.");
    }
    const schedule = this.options.setInterval ?? setInterval;
    this.heartbeatTimer ??= schedule(() => {
      void this.heartbeat().catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    this.initialized = true;
  }

  private assertInitMatches(input: CompanyRuntimeInitInput): void {
    if (input.company_id !== this.identity.company_id) {
      throw new CompanyRuntimeConfigurationError("Company Runtime company_id does not match its configured identity.");
    }
    for (const key of ["members_root", "rooms_root", "executors_root"] as const) {
      if (input.layout[key] !== this.layout[key]) {
        throw new CompanyRuntimeConfigurationError(`Company Runtime layout.${key} does not match its mounted volume.`);
      }
    }
    if (
      JSON.stringify(input.storage_policy) !== JSON.stringify(STORAGE_POLICY)
      || JSON.stringify(input.execution_policy) !== JSON.stringify(EXECUTION_POLICY)
    ) {
      throw new CompanyRuntimeConfigurationError("Company Runtime storage and execution policies must match this runtime.");
    }
  }

  private requireClient(): BackendRuntimeClient {
    if (!this.client) {
      throw new CompanyRuntimeConfigurationError("Company Runtime has not been initialized.");
    }
    return this.client;
  }

  private executorCredentialVersion(executorId: string): number {
    return this.runtime.listMemberAppServers()
      .filter((member) => member.executorId === executorId)
      .reduce((version, member) => Math.max(version, member.credentialVersion), 0);
  }

  private nowMs(): number {
    return this.options.nowMs?.() ?? Date.now();
  }
}

export function companyRuntimeIdentityFromEnv(env: NodeJS.ProcessEnv): CompanyRuntimeIdentity {
  return {
    company_id: requiredEnv(env, "FIELDS_COMPANY_ID"),
  };
}

function memberStatus(member: MemberAppServerRecord, idleTimeoutMs: number): MemberAppServerStatus {
  const state: MemberAppServerStatus["state"] = member.state === "running"
    ? (member.activeExecutionCount > 0 ? "ready" : "idle")
    : member.state;
  return {
    member_id: member.memberId,
    state,
    executor_id: member.executorId,
    credential_version: member.credentialVersion,
    active_turn_count: member.activeExecutionCount,
    last_active_at_ms: member.lastActivityAtMs,
    idle_deadline_at_ms: member.state === "running"
      ? member.lastActivityAtMs + idleTimeoutMs
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

function unavailableReason(
  code: string,
  status: CompanyExecutorUnavailable["status"],
): "disconnected" | "expired" | "revoked" | "invalid_credentials" | "credential_missing" | "runtime_failed" {
  if (status === "expired") return "expired";
  if (code.includes("EXPIRED")) return "expired";
  if (code.includes("REVOKED")) return "revoked";
  if (code.includes("INVALID_CREDENTIAL")) return "invalid_credentials";
  if (code.includes("MISSING")) return "credential_missing";
  if (code.includes("DISCONNECT")) return "disconnected";
  return "runtime_failed";
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new CompanyRuntimeConfigurationError(`${name} is required.`);
  return value;
}
