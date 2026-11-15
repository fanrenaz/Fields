import {
  runAppServerUnixModelOptions,
  runAppServerUnixThreadSettings,
  runAppServerUnixThreadSettingsUpdate,
  runAppServerUnixThreadDelete,
  runAppServerUnixThreadFork,
  runAppServerUnixThreadList,
  runAppServerUnixThreadRead,
  runAppServerUnixThreadResume,
  runAppServerUnixThreadSearch,
  runAppServerUnixThreadStart,
  runAppServerUnixThreadInjectItems,
  runAppServerUnixTurnStream,
  installFieldsCorePlugin,
  verifyFieldsCorePlugin,
  type CodexAppServerRawEvent,
  type CodexAppServerModelOptionsResult,
  type CodexAppServerThreadSettingsResult,
  type CodexAppServerThreadListResult,
  type CodexAppServerThreadReadResult,
  type CodexAppServerThreadSearchResult,
  type CodexAppServerTurnResult,
  type CodexAppServerTurnStreamResult,
  type FieldsCorePluginHealth,
} from "../adapter/codex-bridge.js";
import {
  startCodexAppServerProcess,
  stopCodexAppServerProcess,
  type CodexAppServerStartResult,
  type CodexAppServerStopOptions,
} from "../codex/codex-process.js";
import {
  assertFieldsRoomMessagesNotGloballyEnabled,
  configureCodexIntegration,
} from "../codex/codex.js";
import {
  materializeFieldsPluginMarketplace,
  verifyMaterializedFieldsPluginMarketplace,
  type FieldsPluginMarketplace,
} from "../codex/fields-plugin.js";
import { loginWithChatgptAuthTokens } from "../codex/external-auth.js";
import {
  nativeMemoryNeedsReconciliation,
  reconcileNativeMemory,
} from "../member-memory/native-memory.js";
import {
  assertMemberCodexHomeCredentialFree,
  ensureCompanyRuntimeLayout,
  memberWorkspaceLayout,
  memberCompanyFilesCacheRoot,
  provisionBuilderWorkspace,
  provisionMemberWorkspace,
  removeMemberWorkspace,
  type MemberWorkspaceLayout,
} from "../../infrastructure/filesystem/workspace.js";
import type {
  CompanyRuntimeBuilderScope,
  CompanyExecutorTokenIssueInput,
  CompanyExecutorTokenIssueResult,
  CompanyRuntimeMemberCleanupResult,
} from "@fields/contracts/internal/company-runtime";
import type {
  HomeModelOptionsResult,
  HomeThreadSettingsResult,
  HomeThreadDeleteResult,
  HomeThreadForkInput,
  HomeThreadForkResult,
  HomeThreadListResult,
  HomeThreadReadResult,
  HomeThreadSelectResult,
  HomeThreadSearchResult,
  HomeThreadSummary,
  HomeTurnSubmitResult,
  MessageImageAttachment,
  HomeQuestionInteractionRespondInput,
  HomeQuestionInteractionRespondResult,
  HomeConversationImport,
} from "@fields/contracts/public/home";
import {
  assertImageFile,
  homeImageRenderUri,
  imageMimeTypeFromPath,
  isMessageImageMimeType,
  resolveHomeImageAttachments,
} from "./image-attachments.js";
import type {
  CodexAgentRuntimeEnvelope,
  CodexAgentRuntimeInteractionRequestMethod,
  RoomCodexAgentRuntimeActivityAccepted,
  RoomCodexAgentRuntimeEnvelope,
} from "@fields/contracts/internal/agent-runtime";
import type {
  AgentRoomCompanyFileInput,
  AgentRoomExecutionCompletion,
  AgentRoomInteractionResponseAccepted,
  AgentRoomInteractionResponseDispatch,
} from "@fields/contracts/internal/agent-room";
import type {
  AgentActivityItem,
  AgentQuestionInteraction,
  AgentContent,
  AgentNarrativeItem,
  AgentTurnSnapshot,
  AgentTurnStatus,
} from "@fields/contracts/public/agent-activity";
import type { JsonValue } from "../../generated/codex-app-server-protocol/serde_json/JsonValue.js";
import type { HomeTerminalNotificationInput } from "@fields/contracts/internal/notification";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { MemberTurnEventBus } from "../sessions/event-bus.js";
import {
  readMemberCleanupReceipt,
  readMemberTerminalMarker,
  writeMemberCleanupReceipt,
  writeMemberTerminalMarker,
} from "./cleanup-receipts.js";
import {
  readMemberRuntimeState,
  writeMemberRuntimeState,
} from "./state.js";
import { chmod, lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  emitLifecycleEvent,
  recordMemberActivation,
  recordRoomContextResolution,
} from "../../observability/events.js";
import type { ResolvedMemberAssets } from "../member-assets/service.js";
import {
  collectImportBody,
  discardStagedImport,
  importConversationsAtomic,
  importedTurns,
  parseConversationImport,
  readImportJournal,
  readImportedConversationIndex,
  readImportJob,
  readStagedImportSource,
  recoverableImportJobs,
  removeImportedThreadFromIndex,
  stageImportSource,
  writeImportJournal,
  writeImportJob,
  type ImportedConversationIndex,
  type ImportedThreadIndexRecord,
} from "./conversation-import.js";

export const DEFAULT_MEMBER_IDLE_TIMEOUT_MS = 30 * 60 * 1_000;
const IDLE_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_ACTIVITY_RETRY_DELAYS_MS = [100, 500, 1_000, 5_000, 30_000] as const;
const INTERACTION_RESPONSE_CACHE_LIMIT = 1_000;
export const FIELDS_MAIL_MCP_TOKEN_ENV = "FIELDS_MAIL_MCP_TOKEN";
const HOME_PROJECT_DEVELOPER_INSTRUCTIONS = "You are working inside a HomeChat Project. Treat the current project directory as the primary workspace and prioritize its files and context when answering and taking actions.";

export type RuntimeExecutorTokens = CompanyExecutorTokenIssueResult;

export type RuntimeExecutorTarget = {
  executorId: string;
  credentialVersion?: number;
  memoryEnabled?: boolean;
  memoryManaged?: boolean;
  memoryModel?: string;
};

export type MemberThreadRecord = {
  key: string;
  roomId: string | null;
  roomContextKind?: "agent_execution" | "human_side_chat" | null;
  threadId: string;
  workspaceRoots: string[];
  homeProjectId?: string | null;
  homeBranch?: {
    rootThreadId: string;
    sourceThreadId: string | null;
    anchorTurnId: string | null;
    kind: "root" | "explicit" | "edited_user_message" | "regenerated_assistant";
    selectedThreadId: string;
    revision: number;
    createdAtMs: number | null;
  } | null;
};

export type HomeProjectRecord = {
  projectId: string;
  name: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type HomeMutationReceipt = {
  memberId: string;
  idempotencyKey: string;
  fingerprint: string;
  result:
    | ({ type: "fork" } & HomeThreadForkResult)
    | ({ type: "select" } & HomeThreadSelectResult)
    | ({ type: "delete" } & HomeThreadDeleteResult);
};

export type MemberAppServerRecord = {
  memberId: string;
  executorId: string;
  credentialVersion: number;
  chatgptAccountId: string | null;
  workspace: string;
  codexHome: string;
  socketPath: string | null;
  pid: number | null;
  state: "running" | "stopped" | "switching" | "auth_required" | "failed";
  lastActivityAtMs: number;
  activeExecutionCount: number;
  threads: MemberThreadRecord[];
  plugin: FieldsCorePluginHealth | null;
};

export type AgentRoomExecutionInput = {
  executionId: string;
  idempotencyKey: string;
  memberId: string;
  executor?: RuntimeExecutorTarget;
  roomId: string;
  agentRoomThreadKey: string;
  codexThreadId?: string | null;
  regeneration?: {
    sourceExecutionId: string;
    forkParentThreadId: string;
    forkBeforeTurnId: string;
  } | null;
  prompt: string;
  developerInstructions?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  companyFileInputs?: readonly AgentRoomCompanyFileInput[];
  clientUserMessageId?: string | null;
  timeoutMs?: number;
  completion?: {
    cascadeId: string;
    consumedThroughSequence: number;
    completedAtMs?: () => number;
  };
};

export type AgentRoomExecutionResult = {
  executionId: string;
  idempotencyKey: string;
  memberId: string;
  roomId: string;
  agentRoomThreadKey: string;
  codexThreadId: string;
  codexTurnId: string | null;
  completed: boolean;
  agentText: string;
  completion: AgentRoomExecutionCompletion | null;
  completionPending: boolean;
  replayed: boolean;
};

const EXECUTION_COMPANY_FILE_INPUT_MAX_BYTES = 100 * 1024 * 1024;

async function materializeCompanyFileInputs(
  layout: MemberWorkspaceLayout,
  executionId: string,
  inputs: readonly AgentRoomCompanyFileInput[],
  nowMs: number,
): Promise<string | null> {
  if (inputs.length === 0) return null;
  const safeExecutionId = safeExecutionPathComponent(executionId);
  const root = join(layout.memberRoot, ".runtime", "executions", safeExecutionId, "inputs");
  await removeExecutionInputRoot(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  let totalBytes = 0;
  try {
    for (const input of inputs) {
      totalBytes += input.size_bytes;
      if (
        totalBytes > EXECUTION_COMPANY_FILE_INPUT_MAX_BYTES
        || input.download_expires_at_ms <= nowMs
      ) {
        throw new MemberRuntimeError(
          "company_file_input_invalid",
          "Company File execution inputs exceed their materialization limits.",
          { retryable: input.download_expires_at_ms <= nowMs },
        );
      }
      const response = await fetch(input.download_url, { redirect: "error" });
      if (!response.ok) {
        throw new MemberRuntimeError(
          "company_file_input_unavailable",
          "A referenced Company File version could not be downloaded.",
          { retryable: response.status >= 500 || response.status === 429 },
        );
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        bytes.byteLength !== input.size_bytes
        || createHash("sha256").update(bytes).digest("hex") !== input.sha256
      ) {
        throw new MemberRuntimeError(
          "company_file_input_integrity_failed",
          "A referenced Company File version failed integrity verification.",
          { retryable: false },
        );
      }
      const target = join(
        root,
        safeExecutionPathComponent(input.file_id),
        safeExecutionFileName(input.name),
      );
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const temporary = `${target}.${randomUUID()}.tmp`;
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      await chmod(target, 0o400);
      await chmod(dirname(target), 0o500);
    }
    await chmod(root, 0o500);
    return root;
  } catch (error) {
    await removeExecutionInputRoot(root);
    throw error;
  }
}

async function companyFileImagePaths(
  root: string,
  inputs: readonly AgentRoomCompanyFileInput[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const input of inputs) {
    if (input.as_image !== true || !isMessageImageMimeType(input.mime_type)) continue;
    const path = join(
      root,
      safeExecutionPathComponent(input.file_id),
      safeExecutionFileName(input.name),
    );
    await assertImageFile(path, input.mime_type, input.size_bytes);
    paths.push(path);
  }
  return paths;
}

async function removeExecutionInputRoot(root: string): Promise<void> {
  const makeWritable = async (directory: string): Promise<void> => {
    await chmod(directory, 0o700).catch(() => undefined);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => makeWritable(join(directory, entry.name))));
  };
  await makeWritable(root);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

function safeExecutionPathComponent(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new MemberRuntimeError(
      "company_file_input_invalid",
      "Company File execution input identity is invalid.",
    );
  }
  return value;
}

function safeExecutionFileName(value: string): string {
  if (
    value.length === 0
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")
    || value.includes("\0")
  ) {
    throw new MemberRuntimeError(
      "company_file_input_invalid",
      "Company File execution input name is invalid.",
    );
  }
  return value;
}

export type PendingAgentRoomExecutionCompletion = {
  memberId: string;
  completion: AgentRoomExecutionCompletion;
};

export type MemberExecutorSwitchResult = {
  memberId: string;
  previousExecutorId: string | null;
  targetExecutorId: string;
  switched: boolean;
  rolledBack: boolean;
  threadIdsUnchanged: boolean;
  resumedThreadIds: string[];
  errorCode: string | null;
};

export type MemberRuntimeManagerOptions = {
  runtimeUrl: string;
  idleTimeoutMs?: number;
  issueTokens: (input: {
    executorId: string;
    previousCredentialVersion?: number;
    reason: CompanyExecutorTokenIssueInput["reason"];
  }) => Promise<RuntimeExecutorTokens>;
  proxyEnv?: () => NodeJS.ProcessEnv;
  startProcess?: (
    workdir: string,
    options: { codexHomePath: string; memberId: string; secretEnv?: NodeJS.ProcessEnv },
  ) => Promise<CodexAppServerStartResult>;
  stopProcess?: (
    workdir: string,
    options?: CodexAppServerStopOptions,
  ) => Promise<Record<string, unknown>>;
  login?: (socketPath: string, tokens: RuntimeExecutorTokens) => Promise<void>;
  runTurn?: (input: {
    workdir: string;
    socketPath: string;
    prompt: string;
    localImagePaths?: string[];
    developerInstructions?: string | null;
    codexThreadId?: string | null;
    forkParentThreadId?: string | null;
    forkBeforeTurnId?: string | null;
    clientUserMessageId?: string | null;
    model?: string | null;
    reasoningEffort?: string | null;
    cwd: string;
    runtimeWorkspaceRoots: string[];
    threadConfig?: Record<string, JsonValue> | null;
    timeoutMs?: number;
    beforeTurnStart?: (input: { threadId: string; resumed: boolean }) => Promise<void> | void;
    onEvent?: (event: CodexAppServerRawEvent) => Promise<void> | void;
    onChatgptAuthTokensRefresh: (input: {
      reason: string;
      previousAccountId?: string | null;
    }) => Promise<{
      accessToken: string;
      chatgptAccountId: string;
      chatgptPlanType: string | null;
    }>;
  }) => Promise<CodexAppServerTurnStreamResult>;
  preparePluginMarketplace?: () => Promise<FieldsPluginMarketplace>;
  verifyPluginMarketplace?: (marketplace: FieldsPluginMarketplace) => Promise<void>;
  installPlugin?: (input: {
    socketPath: string;
    marketplacePath: string;
    expectedVersion: string;
  }) => Promise<FieldsCorePluginHealth>;
  verifyPlugin?: (input: {
    socketPath: string;
    marketplacePath: string;
    expectedVersion: string;
  }) => Promise<FieldsCorePluginHealth>;
  resolveMemberAssets?: (memberId: string) => Promise<ResolvedMemberAssets>;
  activateMemberAssets?: (
    socketPath: string,
    assets: ResolvedMemberAssets,
  ) => Promise<Map<string, string>>;
  resumeThread?: (input: {
    socketPath: string;
    threadId: string;
    cwd: string;
    runtimeWorkspaceRoots: string[];
    threadConfig?: Record<string, JsonValue> | null;
  }) => Promise<{ threadId: string }>;
  listThreads?: typeof runAppServerUnixThreadList;
  searchThreads?: typeof runAppServerUnixThreadSearch;
  readThread?: typeof runAppServerUnixThreadRead;
  forkThread?: typeof runAppServerUnixThreadFork;
  deleteThread?: typeof runAppServerUnixThreadDelete;
  startThread?: typeof runAppServerUnixThreadStart;
  injectThreadItems?: typeof runAppServerUnixThreadInjectItems;
  listModelOptions?: typeof runAppServerUnixModelOptions;
  readThreadSettings?: typeof runAppServerUnixThreadSettings;
  updateThreadSettings?: typeof runAppServerUnixThreadSettingsUpdate;
  publishAgentRoomActivity?: (
    event: RoomCodexAgentRuntimeEnvelope,
  ) => Promise<RoomCodexAgentRuntimeActivityAccepted>;
  publishHomeTerminalNotification?: (
    event: Omit<HomeTerminalNotificationInput, "identity">,
  ) => Promise<{ accepted: true; activity_id: string }>;
  onExecutorUnauthorized?: (input: {
    executorId: string;
    credentialVersion: number;
  }) => Promise<void> | void;
  activityRetryDelaysMs?: readonly number[];
  nowMs?: () => number;
  setInterval?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
};

type ManagedMember = {
  layout: MemberWorkspaceLayout;
  executorId: string;
  credentialVersion: number;
  chatgptAccountId: string | null;
  socketPath: string | null;
  pid: number | null;
  state: MemberAppServerRecord["state"];
  lastActivityAtMs: number;
  activeExecutions: Set<Promise<unknown>>;
  threads: Map<string, MemberThreadRecord>;
  switching: boolean;
  plugin: FieldsCorePluginHealth | null;
  assetIssues: Map<string, string>;
  memoryEnabled: boolean;
  memoryManaged: boolean;
  memoryModel: string | null;
};

type CredentialRotationSnapshot = {
  member: ManagedMember;
  threads: MemberThreadRecord[];
};

type PendingAgentRoomInteraction = {
  interactionId: string;
  eventId: string;
  executionId: string;
  roomId: string;
  memberId: string;
  method: CodexAgentRuntimeInteractionRequestMethod;
  requestId: string | number;
  payload: unknown;
  respond: (response: Record<string, unknown>) => Promise<void>;
  state: "pending" | "responding";
};

type PendingHomeQuestionInteraction = {
  interaction: AgentQuestionInteraction;
  memberId: string;
  threadId: string;
  turnId: string;
  respond: (response: Record<string, unknown>) => Promise<void>;
  state: "pending" | "responding";
};

export type HomeQuestionHistoryEntry = {
  interaction: AgentQuestionInteraction;
  memberId: string;
  threadId: string;
  turnId: string;
};

type CachedInteractionResponse = {
  memberId: string;
  fingerprint: string;
  result: AgentRoomInteractionResponseAccepted;
};

type InteractionBindingFlight = {
  memberId: string;
  roomId: string;
  executionId: string;
  promise: Promise<void>;
  resolve: () => void;
};

type MemberCleanupFlight = {
  memberId: string;
  promise: Promise<CompanyRuntimeMemberCleanupResult>;
};

export class MemberRuntimeError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "MemberRuntimeError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
  }
}

export class MemberRuntimeManager {
  private readonly members = new Map<string, ManagedMember>();
  private readonly homeProjectsByMember = new Map<string, Map<string, HomeProjectRecord>>();
  private readonly memberStartFlights = new Map<string, Promise<ManagedMember>>();
  private readonly memberSwitchFlights = new Map<string, Promise<MemberExecutorSwitchResult>>();
  private readonly switchingMembers = new Set<string>();
  private readonly cleanupRequestedMembers = new Set<string>();
  private readonly cleaningMembers = new Set<string>();
  private readonly terminalMembers = new Set<string>();
  private readonly memberCleanupFlights = new Map<string, MemberCleanupFlight>();
  private readonly memberCleanupOperations = new Map<string, MemberCleanupFlight>();
  private readonly threadChains = new Map<string, Promise<void>>();
  private readonly homeMutationChains = new Map<string, Promise<void>>();
  private readonly pendingImportThreadIds = new Set<string>();
  private readonly conversationImportFlights = new Map<string, Promise<void>>();
  private readonly conversationImportMemberChains = new Map<string, Promise<void>>();
  private readonly executionFlights = new Map<string, Promise<AgentRoomExecutionResult>>();
  private readonly executionMembers = new Map<string, string>();
  private readonly memberDispatchAdmissions = new Map<string, Set<Promise<void>>>();
  private readonly executionResults = new Map<string, AgentRoomExecutionResult>();
  private readonly pendingExecutionCompletions = new Map<string, PendingAgentRoomExecutionCompletion>();
  private readonly homeMutationReceipts = new Map<string, HomeMutationReceipt>();
  private readonly completionDeliveryFlights = new Map<string, Set<Promise<void>>>();
  private readonly pendingInteractions = new Map<string, PendingAgentRoomInteraction>();
  private readonly resolvedRoomInteractionIds = new Map<string, string>();
  private readonly pendingHomeQuestions = new Map<string, PendingHomeQuestionInteraction>();
  private readonly homeQuestionHistory = new Map<string, HomeQuestionHistoryEntry>();
  private readonly interactionResponseFlights = new Map<string, {
    memberId: string;
    fingerprint: string;
    promise: Promise<AgentRoomInteractionResponseAccepted>;
  }>();
  private readonly interactionResponses = new Map<string, CachedInteractionResponse>();
  private readonly interactionBindingFlights = new Map<string, Set<InteractionBindingFlight>>();
  private readonly refreshFlights = new Map<string, Promise<RuntimeExecutorTokens>>();
  private readonly mailMcpTokenByMember = new Map<string, string>();
  private readonly mailMcpMemberByToken = new Map<string, string>();
  private readonly builderScopes = new Map<string, CompanyRuntimeBuilderScope>();
  private readonly builderWorkspaces = new Map<string, string>();
  private readonly hydratedMembers = new Set<string>();
  private readonly stateWriteChains = new Map<string, Promise<void>>();
  private readonly turnEvents = new MemberTurnEventBus();
  private readonly options: MemberRuntimeManagerOptions;
  private readonly idleTimeoutMs: number;
  private readonly activityRetryDelaysMs: readonly number[];
  private readonly activityRetryWaiters = new Set<{
    handle: ReturnType<typeof setTimeout>;
    resolve: () => void;
  }>();
  private readonly credentialRotationSnapshots = new Map<string, CredentialRotationSnapshot[]>();
  private proxyRotationSnapshots: CredentialRotationSnapshot[] | null = null;
  private readonly unauthorizedCredentialVersions = new Set<string>();
  private readonly rotatingExecutors = new Set<string>();
  private pluginMarketplaceFlight: Promise<FieldsPluginMarketplace> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private closing = false;

  constructor(readonly workdir: string, options: MemberRuntimeManagerOptions) {
    this.options = options;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_MEMBER_IDLE_TIMEOUT_MS;
    this.activityRetryDelaysMs = options.activityRetryDelaysMs?.length
      ? options.activityRetryDelaysMs
      : DEFAULT_ACTIVITY_RETRY_DELAYS_MS;
  }

  start(): void {
    if (this.idleTimer !== null) return;
    const schedule = this.options.setInterval ?? setInterval;
    this.idleTimer = schedule(() => {
      void this.stopIdleMembers().catch((error) => {
        emitLifecycleEvent("codex.member.stop_failed", {
          code: runtimeErrorCode(error),
          retryable: true,
        });
      });
    }, Math.min(IDLE_SWEEP_INTERVAL_MS, this.idleTimeoutMs));
  }

  async ensureMemberAppServer(
    memberId: string,
    executor: RuntimeExecutorTarget,
  ): Promise<MemberAppServerRecord> {
    await this.assertMemberNotTerminalPersisted(memberId);
    const existing = this.members.get(memberId);
    if (
      existing?.state === "running"
      && existing.executorId === executor.executorId
      && executor.memoryManaged === true
      && typeof executor.memoryModel === "string"
      && (
        existing.memoryEnabled !== (executor.memoryEnabled === true)
        || existing.memoryModel !== executor.memoryModel
      )
    ) {
      await this.restartMemberAppServer(memberId, {
        enabled: executor.memoryEnabled === true,
        model: executor.memoryModel,
      });
    }
    const member = await this.ensureMember(memberId, executor);
    return memberRecord(member);
  }

  memberStatus(memberId: string): MemberAppServerRecord | null {
    const member = this.members.get(memberId);
    return member ? memberRecord(member) : null;
  }

  resolveMailMcpMember(token: string, claimedMemberId: string): string {
    const memberId = this.mailMcpMemberByToken.get(token);
    const member = memberId ? this.members.get(memberId) : null;
    if (
      !memberId
      || memberId !== claimedMemberId
      || !member
      || member.state !== "running"
      || member.socketPath === null
      || member.pid === null
    ) {
      throw new MemberRuntimeError(
        "mail_mcp_identity_invalid",
        "Mail MCP identity is invalid or revoked.",
      );
    }
    return memberId;
  }

  listMemberAppServers(): MemberAppServerRecord[] {
    return [...this.members.values()].map((member) => memberRecord(member));
  }

  prepareFieldsPluginMarketplace(): Promise<FieldsPluginMarketplace> {
    const existing = this.pluginMarketplaceFlight;
    if (existing) return existing;
    const flight = (
      this.options.preparePluginMarketplace
      ?? (() => materializeFieldsPluginMarketplace(this.workdir, {
        runtimeUrl: this.options.runtimeUrl,
      }))
    )().catch((error) => {
      if (this.pluginMarketplaceFlight === flight) {
        this.pluginMarketplaceFlight = null;
      }
      throw error;
    });
    this.pluginMarketplaceFlight = flight;
    return flight;
  }

  private verifyPluginMarketplace(marketplace: FieldsPluginMarketplace): Promise<void> {
    return (
      this.options.verifyPluginMarketplace
      ?? ((selected) => verifyMaterializedFieldsPluginMarketplace(selected, {
        runtimeUrl: this.options.runtimeUrl,
      }))
    )(marketplace);
  }

  async verifyMemberPlugins(): Promise<void> {
    const marketplace = await this.prepareFieldsPluginMarketplace();
    await this.verifyPluginMarketplace(marketplace);
    await Promise.all([...this.members.values()].map(async (member) => {
      if (member.state !== "running" || member.socketPath === null) return;
      try {
        await assertFieldsRoomMessagesNotGloballyEnabled(member.layout.workspace);
        member.plugin = await (this.options.verifyPlugin ?? verifyFieldsCorePlugin)({
          socketPath: member.socketPath,
          marketplacePath: marketplace.marketplacePath,
          expectedVersion: marketplace.version,
        });
      } catch (_error) {
        recordMemberActivation({
          memberId: member.layout.memberId,
          result: "failed",
          stage: "health",
          durationMs: 0,
          code: runtimeErrorCode(_error, "fields_plugin_health_invalid"),
        });
        member.plugin = null;
        member.state = "failed";
        const stopped = await (this.options.stopProcess ?? stopCodexAppServerProcess)(
          member.layout.workspace,
          {
            expectedPid: member.pid ?? undefined,
            requireOwned: member.pid !== null,
          },
        );
        this.assertProcessTerminated(stopped);
        member.socketPath = null;
        member.pid = null;
      }
    }));
  }

  resolveRoomContext(
    memberId: string,
    threadId: string,
  ): {
    memberId: string;
    roomId: string;
    threadId: string;
    accessMode: "agent_execution" | "human_side_chat";
  } {
    const member = this.members.get(memberId);
    if (!member || member.state !== "running" || member.plugin === null) {
      recordRoomContextResolution("unavailable", threadId);
      throw new MemberRuntimeError(
        "mcp_room_context_unavailable",
        "Room context is unavailable for this Codex Thread.",
      );
    }
    const matches = [...member.threads.values()].filter(
      (thread) => thread.threadId === threadId,
    );
    const roomIds = new Set(matches.flatMap((thread) => (
      thread.roomId === null ? [] : [thread.roomId]
    )));
    const accessModes = new Set(matches.flatMap((thread) => (
      thread.roomId === null
        ? []
        : [thread.roomContextKind ?? "agent_execution"]
    )));
    const homeMapped = matches.some((thread) => thread.roomId === null);
    if (roomIds.size === 0 || homeMapped) {
      recordRoomContextResolution(
        roomIds.size > 0 && homeMapped ? "ambiguous" : "unavailable",
        threadId,
      );
      throw new MemberRuntimeError(
        roomIds.size > 0 && homeMapped
          ? "mcp_room_context_ambiguous"
          : "mcp_room_context_unavailable",
        roomIds.size > 0 && homeMapped
          ? "Room context is ambiguous for this Codex Thread."
          : "Room context is unavailable for this Codex Thread.",
      );
    }
    if (roomIds.size !== 1 || accessModes.size !== 1) {
      recordRoomContextResolution("ambiguous", threadId);
      throw new MemberRuntimeError(
        "mcp_room_context_ambiguous",
        "Room context is ambiguous for this Codex Thread.",
      );
    }
    const [roomId] = roomIds;
    const [accessMode] = accessModes;
    if (!roomId || !accessMode) {
      recordRoomContextResolution("unavailable", threadId);
      throw new MemberRuntimeError(
        "mcp_room_context_unavailable",
        "Room context is unavailable for this Codex Thread.",
      );
    }
    recordRoomContextResolution("resolved", threadId);
    return { memberId, roomId, threadId, accessMode };
  }

  async stopMemberAppServer(memberId: string): Promise<{ member_id: string; stopped: true }> {
    const member = this.members.get(memberId);
    if (member) {
      await Promise.allSettled([...member.activeExecutions]);
      await this.stopManagedMember(member);
    }
    return { member_id: memberId, stopped: true };
  }

  runningMemberIds(): string[] {
    return [...this.members.values()]
      .filter((member) => member.state === "running" && member.socketPath !== null)
      .map((member) => member.layout.memberId);
  }

  async restartMemberAppServer(
    memberId: string,
    memory?: { enabled: boolean; model: string },
  ): Promise<Map<string, string>> {
    this.assertOpen();
    await this.assertMemberNotTerminalPersisted(memberId);
    this.assertMemberNotTerminal(memberId);
    const current = await this.ensureKnownMember(memberId);
    const existingFlight = this.memberSwitchFlights.get(memberId);
    if (existingFlight) {
      await existingFlight;
      return this.members.get(memberId)?.assetIssues ?? new Map();
    }
    this.switchingMembers.add(memberId);
    current.switching = true;
    current.state = "switching";
    const flight = (async (): Promise<MemberExecutorSwitchResult> => {
      await Promise.allSettled([
        ...current.activeExecutions,
        ...[...this.executionFlights.entries()]
          .filter(([idempotencyKey]) => this.executionMembers.get(idempotencyKey) === memberId)
          .map(([, execution]) => execution),
      ]);
      const threads = [...current.threads.values()].map((thread) => ({
        ...thread,
        workspaceRoots: [...thread.workspaceRoots],
      }));
      if (memory) {
        await reconcileNativeMemory({
          socketPath: requireSocket(current),
          codexHome: current.layout.codexHome,
          target: memory,
        });
      }
      await this.stopManagedMember(current);
      const replacement = await this.startManagedMember(
        current.layout,
        {
          executorId: current.executorId,
          credentialVersion: current.credentialVersion,
          memoryEnabled: memory?.enabled ?? current.memoryEnabled,
          memoryManaged: memory ? true : current.memoryManaged,
          memoryModel: memory?.model ?? current.memoryModel ?? undefined,
        },
        threads,
        "executor_switch",
      );
      await this.resumeRegisterAndPersistStartedMember(replacement, threads, current);
      if (memory && replacement.memoryEnabled !== memory.enabled) {
        throw new MemberRuntimeError(
          "member_memory_apply_failed",
          "Codex native memory configuration could not be applied.",
          { retryable: true },
        );
      }
      return {
        memberId,
        previousExecutorId: current.executorId,
        targetExecutorId: current.executorId,
        switched: true,
        rolledBack: false,
        threadIdsUnchanged: true,
        resumedThreadIds: threads.map((thread) => thread.threadId),
        errorCode: null,
      };
    })().finally(() => {
      this.switchingMembers.delete(memberId);
      const active = this.members.get(memberId);
      if (active) active.switching = false;
      if (this.memberSwitchFlights.get(memberId) === flight) {
        this.memberSwitchFlights.delete(memberId);
      }
    });
    this.memberSwitchFlights.set(memberId, flight);
    await flight;
    return this.members.get(memberId)?.assetIssues ?? new Map();
  }

  async memberFilesystemSocket(memberId: string): Promise<string> {
    const member = await this.ensureKnownMember(memberId);
    if (!member.socketPath) {
      throw new MemberRuntimeError("member_app_server_stopped", "Member App Server is not running.", { retryable: true });
    }
    return member.socketPath;
  }

  async listHomeModelOptions(memberId: string): Promise<HomeModelOptionsResult> {
    const member = await this.ensureKnownMember(memberId);
    const result: CodexAppServerModelOptionsResult = await (
      this.options.listModelOptions ?? runAppServerUnixModelOptions
    )({
      socketPath: requireSocket(member),
    });
    return {
      items: result.items.map((model) => ({
        model: model.model,
        display_name: model.displayName,
        is_default: model.isDefault,
        default_reasoning_effort: model.defaultReasoningEffort,
        supported_reasoning_efforts: model.supportedReasoningEfforts,
      })),
      new_thread_default: result.newThreadDefault === null
        ? null
        : {
          model: result.newThreadDefault.model,
          reasoning_effort: result.newThreadDefault.reasoningEffort,
        },
    };
  }

  async readHomeThreadSettings(memberId: string, threadId: string): Promise<HomeThreadSettingsResult> {
    const member = await this.ensureKnownMember(memberId);
    this.assertHomeThread(member, threadId);
    const workspaceRoots = member.threads.get(`home:${threadId}`)?.workspaceRoots ?? [member.layout.workspace];
    const result: CodexAppServerThreadSettingsResult = await (
      this.options.readThreadSettings ?? runAppServerUnixThreadSettings
    )({
      socketPath: requireSocket(member),
      threadId,
      cwd: workspaceRoots.length === 1 ? workspaceRoots[0]! : member.layout.workspace,
      runtimeWorkspaceRoots: workspaceRoots,
    });
    return {
      thread_id: result.threadId,
      model: result.model,
      reasoning_effort: result.reasoningEffort,
    };
  }

  async updateHomeThreadSettings(input: {
    memberId: string;
    threadId: string;
    model: string;
    reasoningEffort: string | null;
  }): Promise<HomeThreadSettingsResult> {
    const member = await this.ensureKnownMember(input.memberId);
    this.assertHomeThread(member, input.threadId);
    const workspaceRoots = member.threads.get(`home:${input.threadId}`)?.workspaceRoots ?? [member.layout.workspace];
    try {
      const result: CodexAppServerThreadSettingsResult = await (
        this.options.updateThreadSettings ?? runAppServerUnixThreadSettingsUpdate
      )({
        socketPath: requireSocket(member),
        threadId: input.threadId,
        cwd: workspaceRoots.length === 1 ? workspaceRoots[0]! : member.layout.workspace,
        runtimeWorkspaceRoots: workspaceRoots,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
      });
      emitLifecycleEvent("codex.home.thread_settings.update", {
        result: "succeeded",
        retryable: false,
        "fields.actor_id": input.memberId,
        "fields.thread_id": input.threadId,
      });
      return {
        thread_id: result.threadId,
        model: result.model,
        reasoning_effort: result.reasoningEffort,
      };
    } catch (error) {
      emitLifecycleEvent("codex.home.thread_settings.update", {
        result: "failed",
        code: runtimeErrorCode(error),
        retryable: true,
        "fields.actor_id": input.memberId,
        "fields.thread_id": input.threadId,
      });
      throw error;
    }
  }

  async submitHomeTurn(input: {
    memberId: string;
    threadId?: string | null;
    projectId?: string | null;
    prompt: string;
    imageAttachments?: readonly MessageImageAttachment[];
    builderScope?: CompanyRuntimeBuilderScope;
    developerInstructions?: string | null;
    clientMessageId?: string | null;
    model?: string | null;
    reasoningEffort?: string | null;
    timeoutMs?: number;
  }): Promise<HomeTurnSubmitResult> {
    await this.assertMemberNotTerminalPersisted(input.memberId);
    const member = await this.ensureKnownMember(input.memberId);
    if (input.threadId) this.assertHomeThread(member, input.threadId);
    const requestedThreadId = input.threadId
      ? ensureHomeBranch(member, input.threadId, this.nowMs()).selectedThreadId
      : null;
    const existingProjectId = requestedThreadId
      ? member.threads.get(`home:${requestedThreadId}`)?.homeProjectId ?? null
      : null;
    const projectId = input.threadId ? existingProjectId : input.projectId ?? null;
    if (projectId && input.builderScope) {
      throw new MemberRuntimeError("home_project_builder_scope_conflict", "Project conversations cannot use a Builder workspace.");
    }
    const project = projectId ? this.requireHomeProject(input.memberId, projectId) : null;
    const turnWorkspace = input.builderScope
      ? (await provisionBuilderWorkspace(
        this.workdir,
        input.memberId,
        input.builderScope.kind,
        input.builderScope.topic_id,
      )).workspace
      : project
        ? await requireHomeProjectWorkspace(member, project.projectId)
        : member.layout.workspace;
    const developerInstructions = project
      ? [HOME_PROJECT_DEVELOPER_INSTRUCTIONS, input.developerInstructions].filter(Boolean).join("\n\n")
      : input.developerInstructions ?? null;
    const localImagePaths = await resolveHomeImageAttachments(
      member.layout,
      input.imageAttachments ?? [],
    );
    let observedThreadId = requestedThreadId;
    let observedTurnId: string | null = null;
    let observedTerminalStatus: HomeTerminalNotificationInput["status"] | null = null;
    let observedOccurredAtMs: number | null = null;
    const execution = this.runTurn(member, {
      prompt: input.prompt,
      localImagePaths,
      developerInstructions,
      codexThreadId: requestedThreadId,
      clientUserMessageId: input.clientMessageId ?? null,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      cwd: turnWorkspace,
      workspaceRoots: localImagePaths.length > 0
        ? [...new Set([turnWorkspace, member.layout.workspace])]
        : [turnWorkspace],
      timeoutMs: input.timeoutMs,
      eventScope: { type: "home" },
      onHomeEvent: (event) => {
        observedThreadId = event.threadId ?? observedThreadId;
        observedTurnId = event.turnId ?? observedTurnId;
        if (event.method === "turn/completed") {
          observedTerminalStatus = homeTerminalStatus(event);
          observedOccurredAtMs = event.occurredAtMs;
        }
      },
      beforeTurnStart: ({ threadId }) => {
        this.assertHomeThread(member, threadId);
        if (input.builderScope) {
          this.builderScopes.set(builderScopeKey(input.memberId, threadId), input.builderScope);
          this.builderWorkspaces.set(builderScopeKey(input.memberId, threadId), turnWorkspace);
        }
      },
    });
    if (project) project.updatedAtMs = this.nowMs();
    member.activeExecutions.add(execution);
    let turn: CodexAppServerTurnResult;
    try {
      turn = await execution;
    } catch (error) {
      if (observedThreadId && (observedTurnId || input.clientMessageId)) {
        await this.publishHomeTerminalNotification({
          event_id: `home-terminal:${input.memberId}:${observedTurnId ?? `client:${input.clientMessageId}`}`,
          recipient_actor_id: input.memberId,
          thread_id: observedThreadId,
          thread_title: homeTerminalTitle(input.prompt),
          status: observedTerminalStatus ?? homeTerminalErrorStatus(error),
          preview: null,
          occurred_at_ms: observedOccurredAtMs ?? this.nowMs(),
        });
      }
      throw error;
    } finally {
      member.activeExecutions.delete(execution);
      member.lastActivityAtMs = this.nowMs();
    }
    if (!turn.threadId || !turn.turnId) {
      throw new MemberRuntimeError("codex_turn_identity_missing", "Codex did not return a Home Thread and Turn id.");
    }
    this.assertHomeThread(member, turn.threadId);
    member.threads.set(`home:${turn.threadId}`, {
      key: `home:${turn.threadId}`,
      roomId: null,
      threadId: turn.threadId,
      workspaceRoots: [turnWorkspace],
      homeProjectId: project?.projectId ?? null,
      homeBranch: input.threadId
        ? member.threads.get(`home:${turn.threadId}`)?.homeBranch ?? null
        : {
          rootThreadId: turn.threadId,
          sourceThreadId: null,
          anchorTurnId: null,
          kind: "root",
          selectedThreadId: turn.threadId,
          revision: 1,
          createdAtMs: this.nowMs(),
        },
    });
    await this.persistMemberState(member);
    await this.publishHomeTerminalNotification({
      event_id: `home-terminal:${input.memberId}:${turn.turnId}`,
      recipient_actor_id: input.memberId,
      thread_id: turn.threadId,
      thread_title: homeTerminalTitle(input.prompt),
      status: observedTerminalStatus ?? (turn.completed ? "completed" : "failed"),
      preview: homeTerminalPreview(turn.agentText),
      occurred_at_ms: observedOccurredAtMs ?? this.nowMs(),
    });
    return { submitted: true, thread_id: turn.threadId, turn_id: turn.turnId };
  }

  async submitRoomSideChatTurn(input: {
    memberId: string;
    roomId: string;
    threadId?: string | null;
    prompt: string;
    developerInstructions: string;
    model?: string | null;
    reasoningEffort?: string | null;
    clientMessageId?: string | null;
    timeoutMs?: number;
  }): Promise<HomeTurnSubmitResult> {
    return this.withHomeMutationLock(
      `${input.memberId}\0room-side:${input.roomId}`,
      async () => {
        await this.assertMemberNotTerminalPersisted(input.memberId);
        const member = await this.ensureKnownMember(input.memberId);
        const key = `room-side:${input.roomId}`;
        const mapped = member.threads.get(key);
        if (
          mapped
          && (
            mapped.roomId !== input.roomId
            || (mapped.roomContextKind ?? "agent_execution") !== "human_side_chat"
          )
        ) {
          throw new MemberRuntimeError(
            "room_side_chat_context_mismatch",
            "The private Room chat mapping does not match the requested Room.",
          );
        }
        if (input.threadId && mapped && input.threadId !== mapped.threadId) {
          throw new MemberRuntimeError(
            "room_side_chat_thread_mismatch",
            "The persisted private Room chat Thread does not match the Runtime mapping.",
          );
        }
        const requestedThreadId = mapped?.threadId ?? input.threadId ?? null;
        const execution = this.runTurn(member, {
          prompt: input.prompt,
          developerInstructions: input.developerInstructions,
          model: input.model ?? null,
          reasoningEffort: input.reasoningEffort ?? null,
          codexThreadId: requestedThreadId,
          clientUserMessageId: input.clientMessageId ?? null,
          workspaceRoots: [member.layout.workspace],
          timeoutMs: input.timeoutMs,
          eventScope: {
            type: "room_side_chat",
            roomId: input.roomId,
            eventKey: key,
          },
          beforeTurnStart: async ({ threadId, resumed }) => {
            await this.prepareRoomThreadForTurn(member, {
              key,
              roomId: input.roomId,
              roomContextKind: "human_side_chat",
              threadId,
              workspaceRoots: [member.layout.workspace],
              resumed,
            });
          },
        });
        member.activeExecutions.add(execution);
        let turn: CodexAppServerTurnResult;
        try {
          turn = await execution;
        } finally {
          member.activeExecutions.delete(execution);
          member.lastActivityAtMs = this.nowMs();
        }
        if (!turn.threadId || !turn.turnId) {
          throw new MemberRuntimeError(
            "codex_turn_identity_missing",
            "Codex did not return a private Room chat Thread and Turn id.",
          );
        }
        member.threads.set(key, {
          key,
          roomId: input.roomId,
          roomContextKind: "human_side_chat",
          threadId: turn.threadId,
          workspaceRoots: [member.layout.workspace],
        });
        await this.persistMemberState(member);
        return { submitted: true, thread_id: turn.threadId, turn_id: turn.turnId };
      },
    );
  }

  async readRoomSideChatThread(
    memberId: string,
    roomId: string,
    threadId: string,
  ): Promise<HomeThreadReadResult> {
    const member = await this.ensureKnownMember(memberId);
    const mapped = member.threads.get(`room-side:${roomId}`);
    if (
      !mapped
      || mapped.threadId !== threadId
      || mapped.roomId !== roomId
      || mapped.roomContextKind !== "human_side_chat"
    ) {
      throw new MemberRuntimeError(
        "room_side_chat_thread_mismatch",
        "The private Room chat Thread is unavailable.",
      );
    }
    const result = await (this.options.readThread ?? runAppServerUnixThreadRead)({
      socketPath: requireSocket(member),
      threadId,
      timeoutMs: 60_000,
    });
    return homeThreadReadData(threadId, [{ threadId, result }], [{
      threadId,
      homeBranch: {
        rootThreadId: threadId,
        sourceThreadId: null,
        anchorTurnId: null,
        kind: "root",
        selectedThreadId: threadId,
        revision: 1,
        createdAtMs: null,
      },
    }], member.layout.workspace);
  }

  roomSideChatTurnEventStream(
    memberId: string,
    roomId: string,
    input: { signal?: AbortSignal | null } = {},
  ): AsyncGenerator<CodexAgentRuntimeEnvelope> {
    return this.turnEvents.subscribe(memberId, `room-side:${roomId}`, input);
  }

  homeTurnEventStream(
    memberId: string,
    threadId: string,
    input: { signal?: AbortSignal | null } = {},
  ): AsyncGenerator<CodexAgentRuntimeEnvelope> {
    return this.turnEvents.subscribe(memberId, threadId, input);
  }

  async respondHomeQuestionInteraction(
    memberId: string,
    input: HomeQuestionInteractionRespondInput,
  ): Promise<HomeQuestionInteractionRespondResult> {
    const pending = this.pendingHomeQuestions.get(input.interaction_id);
    if (!pending || pending.memberId !== memberId || pending.threadId !== input.thread_id || pending.state !== "pending") {
      throw new MemberRuntimeError("interaction_not_pending", "The Home question is no longer pending.");
    }
    validateQuestionAnswers(pending.interaction, input.answers);
    pending.state = "responding";
    try {
      await pending.respond({
        answers: Object.fromEntries(Object.entries(input.answers).map(([id, answers]) => [id, { answers }])),
      });
      const completedAtMs = this.nowMs();
      const completed = completeQuestionInteraction(
        pending.interaction,
        input.answers,
        input.resolution,
        completedAtMs,
      );
      this.pendingHomeQuestions.delete(input.interaction_id);
      this.homeQuestionHistory.set(input.interaction_id, {
        interaction: completed,
        memberId,
        threadId: input.thread_id,
        turnId: pending.turnId,
      });
      while (this.homeQuestionHistory.size > INTERACTION_RESPONSE_CACHE_LIMIT) {
        const oldest = this.homeQuestionHistory.keys().next().value as string | undefined;
        if (!oldest) break;
        this.homeQuestionHistory.delete(oldest);
      }
      this.turnEvents.publish(memberId, input.thread_id, {
        schema_version: 1,
        event_id: randomUUID(),
        provider: "codex",
        type: "agent_runtime.event",
        source: "company-runtime",
        scope: { type: "home", member_id: memberId, thread_id: input.thread_id },
        turn_id: pending.turnId,
        method: "fields/questionInteractionResolved",
        item_id: completed.item_id,
        payload: completed,
        occurred_at_ms: completedAtMs,
      });
      const member = await this.ensureKnownMember(memberId);
      await this.persistMemberState(member);
      return { accepted: true, interaction_id: input.interaction_id };
    } catch (error) {
      pending.state = "pending";
      throw error;
    }
  }

  snoozeHomeQuestionInteraction(
    memberId: string,
    input: { thread_id: string; interaction_id: string; mode: "foreground" | "background" },
  ): { accepted: true; deadline_at_ms: number } {
    const pending = this.pendingHomeQuestions.get(input.interaction_id);
    if (!pending || pending.memberId !== memberId || pending.threadId !== input.thread_id || pending.state !== "pending") {
      throw new MemberRuntimeError("interaction_not_pending", "The Home question is no longer pending.");
    }
    const deadlineAtMs = this.nowMs() + (input.mode === "foreground" ? 150_000 : 90_000);
    pending.interaction = { ...pending.interaction, deadline_at_ms: deadlineAtMs };
    this.homeQuestionHistory.set(input.interaction_id, {
      interaction: pending.interaction,
      memberId,
      threadId: input.thread_id,
      turnId: pending.turnId,
    });
    this.scheduleHomeQuestionTimeout(input.interaction_id, deadlineAtMs);
    return { accepted: true, deadline_at_ms: deadlineAtMs };
  }

  private scheduleHomeQuestionTimeout(interactionId: string, deadlineAtMs: number): void {
    const attempt = (): void => {
      const pending = this.pendingHomeQuestions.get(interactionId);
      if (!pending || pending.interaction.deadline_at_ms !== deadlineAtMs || pending.state !== "pending") return;
      if (this.nowMs() < deadlineAtMs) {
        setTimeout(attempt, Math.max(1, deadlineAtMs - this.nowMs()));
        return;
      }
      void this.respondHomeQuestionInteraction(pending.memberId, {
        thread_id: pending.threadId,
        interaction_id: interactionId,
        answers: {},
        resolution: "timed_out",
      }).catch(() => setTimeout(attempt, 5_000));
    };
    setTimeout(attempt, Math.max(1, deadlineAtMs - this.nowMs()));
  }

  homeAllTurnEventStream(memberId: string, input: { signal?: AbortSignal | null } = {}): AsyncGenerator<CodexAgentRuntimeEnvelope> {
    return this.turnEvents.subscribeMember(memberId, input);
  }

  async createHomeConversationImport(input: {
    memberId: string;
    name: string;
    body: AsyncIterable<unknown>;
  }): Promise<HomeConversationImport> {
    const member = await this.ensureKnownMember(input.memberId);
    const bytes = await collectImportBody(input.body);
    const now = this.nowMs();
    const job: HomeConversationImport = {
      import_id: `import_${randomUUID()}`,
      status: "queued",
      total_conversations: 0,
      processed_conversations: 0,
      skipped_conversations: 0,
      created_threads: 0,
      error_code: null,
      created_at_ms: now,
      completed_at_ms: null,
    };
    await stageImportSource(member.layout, job.import_id, input.name, bytes);
    await writeImportJob(member.layout, job);
    const previous = this.conversationImportMemberChains.get(input.memberId) ?? Promise.resolve();
    const flight = previous.catch(() => undefined)
      .then(() => this.runHomeConversationImport(member, job, input.name, bytes))
      .finally(() => {
        this.conversationImportFlights.delete(job.import_id);
        if (this.conversationImportMemberChains.get(input.memberId) === flight) this.conversationImportMemberChains.delete(input.memberId);
      });
    this.conversationImportFlights.set(job.import_id, flight);
    this.conversationImportMemberChains.set(input.memberId, flight);
    void flight.catch(() => undefined);
    return { ...job };
  }

  async readHomeConversationImport(memberId: string, importId: string): Promise<HomeConversationImport> {
    const member = await this.ensureKnownMember(memberId);
    return readImportJob(member.layout, importId);
  }

  private async runHomeConversationImport(
    member: ManagedMember,
    job: HomeConversationImport,
    name: string,
    bytes: Buffer,
  ): Promise<void> {
    const journalIds = new Set(await readImportJournal(member.layout, job.import_id));
    const update = async (patch: Partial<HomeConversationImport>) => {
      Object.assign(job, patch);
      await writeImportJob(member.layout, job);
    };
    try {
      await update({ status: "validating" });
      const conversations = await parseConversationImport(name, bytes);
      await update({ status: "importing", total_conversations: conversations.length });
      const socketPath = requireSocket(member);
      const result = await importConversationsAtomic({
        layout: member.layout,
        conversations,
        nowMs: this.nowMs(),
        runtime: {
          startThread: async () => {
            const started = await (this.options.startThread ?? runAppServerUnixThreadStart)({
              socketPath,
              cwd: member.layout.workspace,
              runtimeWorkspaceRoots: [member.layout.workspace],
              threadSource: "fields_conversation_import",
              injectAnchor: false,
              timeoutMs: 60_000,
            });
            this.pendingImportThreadIds.add(started.threadId);
            journalIds.add(started.threadId);
            await writeImportJournal(member.layout, job.import_id, [...journalIds]);
            return started.threadId;
          },
          injectItems: (threadId, items) => (this.options.injectThreadItems ?? runAppServerUnixThreadInjectItems)({
            socketPath,
            threadId,
            items,
            timeoutMs: 60_000,
          }),
          forkThread: async (parentThreadId) => {
            const forked = await (this.options.forkThread ?? runAppServerUnixThreadFork)({
              socketPath,
              parentThreadId,
              threadSource: "fields_conversation_import",
              timeoutMs: 60_000,
            });
            this.pendingImportThreadIds.add(forked.threadId);
            journalIds.add(forked.threadId);
            await writeImportJournal(member.layout, job.import_id, [...journalIds]);
            return forked.threadId;
          },
          deleteThread: async (threadId) => {
            await (this.options.deleteThread ?? runAppServerUnixThreadDelete)({ socketPath, threadId, timeoutMs: 60_000 });
            this.pendingImportThreadIds.delete(threadId);
            journalIds.delete(threadId);
            await writeImportJournal(member.layout, job.import_id, [...journalIds]);
          },
        },
        onProgress: async (processed, createdThreads) => {
          job.processed_conversations = processed;
          job.created_threads = createdThreads;
          await writeImportJob(member.layout, job);
        },
        onRollback: () => update({ status: "rolling_back" }),
      });
      this.installImportedHomeBranches(member, result.index, new Set(result.createdThreadIds));
      await this.persistMemberState(member).catch(() => undefined);
      result.createdThreadIds.forEach((threadId) => this.pendingImportThreadIds.delete(threadId));
      await update({
        status: "succeeded",
        processed_conversations: conversations.length,
        skipped_conversations: result.skipped,
        created_threads: result.createdThreadIds.length,
        completed_at_ms: this.nowMs(),
      });
      await discardStagedImport(member.layout, job.import_id);
      emitLifecycleEvent("codex.home.conversation_import", {
        result: "succeeded",
        code: "completed",
        retryable: false,
        "fields.actor_id": member.layout.memberId,
        "fields.operation_id": job.import_id,
        "fields.thread_count": result.createdThreadIds.length,
      });
    } catch (error) {
      const errorCode = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "conversation_import_failed";
      await update({
        status: "failed",
        error_code: errorCode,
        completed_at_ms: this.nowMs(),
      });
      if (errorCode !== "conversation_import_rollback_pending") {
        await discardStagedImport(member.layout, job.import_id);
      }
      emitLifecycleEvent("codex.home.conversation_import", {
        result: "failed",
        code: job.error_code ?? "conversation_import_failed",
        retryable: false,
        "fields.actor_id": member.layout.memberId,
        "fields.operation_id": job.import_id,
      });
    }
  }

  private scheduleConversationImportRecovery(member: ManagedMember): void {
    const memberId = member.layout.memberId;
    const previous = this.conversationImportMemberChains.get(memberId) ?? Promise.resolve();
    const flight = previous.catch(() => undefined)
      .then(async () => {
        const jobs = await recoverableImportJobs(member.layout);
        for (const job of jobs) {
          const socketPath = requireSocket(member);
          const journalIds = await readImportJournal(member.layout, job.import_id);
          let cleanupFailed = false;
          for (const threadId of [...journalIds].reverse()) {
            try {
              await (this.options.deleteThread ?? runAppServerUnixThreadDelete)({ socketPath, threadId, timeoutMs: 60_000 });
              this.pendingImportThreadIds.delete(threadId);
              member.threads.delete(`home:${threadId}`);
              await removeImportedThreadFromIndex(member.layout, threadId);
              const remaining = journalIds.filter((candidate) => candidate !== threadId);
              journalIds.splice(0, journalIds.length, ...remaining);
              await writeImportJournal(member.layout, job.import_id, journalIds);
            } catch {
              cleanupFailed = true;
            }
          }
          if (cleanupFailed) {
            Object.assign(job, {
              status: "failed" as const,
              error_code: "conversation_import_rollback_pending",
              completed_at_ms: this.nowMs(),
            });
            await writeImportJob(member.layout, job);
            continue;
          }
          try {
            const source = await readStagedImportSource(member.layout, job.import_id);
            await this.runHomeConversationImport(member, job, source.name, source.bytes);
          } catch (error) {
            Object.assign(job, {
              status: "failed" as const,
              error_code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "conversation_import_recovery_failed",
              completed_at_ms: this.nowMs(),
            });
            await writeImportJob(member.layout, job);
          }
        }
      })
      .finally(() => {
        if (this.conversationImportMemberChains.get(memberId) === flight) this.conversationImportMemberChains.delete(memberId);
      });
    this.conversationImportMemberChains.set(memberId, flight);
    void flight.catch(() => undefined);
  }

  private installImportedHomeBranches(member: ManagedMember, index: ImportedConversationIndex, created: ReadonlySet<string>): void {
    for (const record of index.records) {
      if (!created.has(record.threadId)) continue;
      member.threads.set(`home:${record.threadId}`, {
        key: `home:${record.threadId}`,
        roomId: null,
        threadId: record.threadId,
        workspaceRoots: [member.layout.workspace],
        homeBranch: {
          rootThreadId: record.rootThreadId,
          sourceThreadId: record.sourceThreadId,
          anchorTurnId: record.anchorTurnId,
          kind: record.branchKind,
          selectedThreadId: record.selectedThreadId,
          revision: 1,
          createdAtMs: record.createdAtMs,
        },
      });
    }
  }

  async listHomeProjects(memberId: string) {
    await this.ensureKnownMember(memberId);
    return {
      items: [...(this.homeProjectsByMember.get(memberId)?.values() ?? [])]
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
        .map(homeProjectData),
    };
  }

  async createHomeProject(input: { memberId: string; name: string }) {
    const member = await this.ensureKnownMember(input.memberId);
    const now = this.nowMs();
    const project: HomeProjectRecord = {
      projectId: `project_${randomUUID()}`,
      name: input.name.trim(),
      createdAtMs: now,
      updatedAtMs: now,
    };
    await ensureHomeProjectsRoot(member);
    await mkdir(homeProjectWorkspace(member, project.projectId), { recursive: false, mode: 0o700 });
    const projects = this.homeProjectsByMember.get(input.memberId) ?? new Map<string, HomeProjectRecord>();
    projects.set(project.projectId, project);
    this.homeProjectsByMember.set(input.memberId, projects);
    await this.persistMemberState(member);
    emitLifecycleEvent("codex.home.project.create", {
      result: "succeeded", retryable: false, "fields.actor_id": input.memberId,
      "fields.project_id": project.projectId,
    });
    return homeProjectData(project);
  }

  async updateHomeProject(input: { memberId: string; projectId: string; name: string }) {
    const member = await this.ensureKnownMember(input.memberId);
    const project = this.requireHomeProject(input.memberId, input.projectId);
    project.name = input.name.trim();
    project.updatedAtMs = this.nowMs();
    await this.persistMemberState(member);
    emitLifecycleEvent("codex.home.project.update", {
      result: "succeeded", retryable: false, "fields.actor_id": input.memberId,
      "fields.project_id": project.projectId,
    });
    return homeProjectData(project);
  }

  async moveHomeThreadToProject(input: { memberId: string; threadId: string; projectId: string | null }) {
    const member = await this.ensureKnownMember(input.memberId);
    this.assertHomeThread(member, input.threadId);
    if (member.activeExecutions.size > 0) {
      throw new MemberRuntimeError("home_project_thread_active", "Wait for active Home turns to finish before moving a conversation.", { retryable: true });
    }
    const rootThreadId = ensureHomeBranch(member, input.threadId, this.nowMs()).rootThreadId;
    const target = input.projectId ? this.requireHomeProject(input.memberId, input.projectId) : null;
    const workspace = target ? await requireHomeProjectWorkspace(member, target.projectId) : member.layout.workspace;
    const branches = homeBranches(member, rootThreadId);
    const resume = this.options.resumeThread ?? runAppServerUnixThreadResume;
    for (const branch of branches) {
      const resumed = await resume({
        socketPath: requireSocket(member), threadId: branch.threadId, cwd: workspace,
        runtimeWorkspaceRoots: withCompanyFilesCache(member.layout, [workspace]), threadConfig: null,
      });
      if (resumed.threadId !== branch.threadId) {
        throw new MemberRuntimeError("codex_thread_identity_changed", "Codex resumed a different Thread while moving the conversation.");
      }
    }
    for (const branch of branches) {
      const record = member.threads.get(`home:${branch.threadId}`);
      if (!record) continue;
      record.homeProjectId = target?.projectId ?? null;
      record.workspaceRoots = [workspace];
    }
    if (target) target.updatedAtMs = this.nowMs();
    await this.persistMemberState(member);
    emitLifecycleEvent("codex.home.project.thread_move", {
      result: "succeeded", retryable: false, "fields.actor_id": input.memberId,
      "fields.thread_id": input.threadId, "fields.project_id": target?.projectId ?? "home",
    });
    return { root_thread_id: rootThreadId, project_id: target?.projectId ?? null };
  }

  async deleteHomeProject(input: { memberId: string; projectId: string; confirmationName: string }) {
    const member = await this.ensureKnownMember(input.memberId);
    const project = this.requireHomeProject(input.memberId, input.projectId);
    if (input.confirmationName !== project.name) {
      throw new MemberRuntimeError("home_project_confirmation_mismatch", "Project name confirmation does not match.");
    }
    const roots = new Set([...member.threads.values()]
      .filter((thread) => thread.roomId === null && thread.homeProjectId === project.projectId)
      .map((thread) => thread.homeBranch?.rootThreadId ?? thread.threadId));
    for (const rootThreadId of roots) {
      await this.moveHomeThreadToProject({ memberId: input.memberId, threadId: rootThreadId, projectId: null });
    }
    const workspace = homeProjectWorkspace(member, project.projectId);
    const metadata = await lstat(workspace);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new MemberRuntimeError("home_project_workspace_invalid", "Project workspace is not a regular directory.");
    }
    await rm(workspace, { recursive: true });
    this.homeProjectsByMember.get(input.memberId)?.delete(project.projectId);
    await this.persistMemberState(member);
    emitLifecycleEvent("codex.home.project.delete", {
      result: "succeeded", retryable: false, "fields.actor_id": input.memberId,
      "fields.project_id": project.projectId,
    });
    return { deleted: true as const, project_id: project.projectId };
  }

  private requireHomeProject(memberId: string, projectId: string): HomeProjectRecord {
    const project = this.homeProjectsByMember.get(memberId)?.get(projectId);
    if (!project) throw new MemberRuntimeError("home_project_not_found", "Home Project does not exist.");
    return project;
  }

  async listHomeThreads(input: {
    memberId: string;
    projectId?: string | null;
    cursor?: string | null;
    limit?: number;
    archived?: boolean;
  }): Promise<HomeThreadListResult> {
    const member = await this.ensureKnownMember(input.memberId);
    const workspace = input.projectId
      ? await requireHomeProjectWorkspace(member, this.requireHomeProject(input.memberId, input.projectId).projectId)
      : member.layout.workspace;
    const imported = homeProjectImportedIndex(
      member,
      await readImportedConversationIndex(member.layout),
      input.projectId ?? null,
    );
    const excluded = new Set([...roomMappedThreadIds(member), ...this.pendingImportThreadIds]);
    const listThreads = this.options.listThreads ?? runAppServerUnixThreadList;
    if (imported.records.length === 0) {
      const result = await listThreads({
        socketPath: requireSocket(member), cwd: workspace, cursor: input.cursor,
        limit: input.limit, archived: input.archived, timeoutMs: 60_000,
      });
      return homeThreadListData(result, excluded);
    }
    const results = await collectNativeThreadPages(async (cursor) => listThreads({
      socketPath: requireSocket(member), cwd: workspace, cursor,
      limit: 100, archived: input.archived, timeoutMs: 60_000,
    }));
    const all = overlayImportedThreadSummaries(homeThreadListData({ threads: results, nextCursor: null, backwardsCursor: null }, excluded), imported);
    return paginateImportedThreadSummaries(all, input.cursor, input.limit);
  }

  async searchHomeThreads(input: {
    memberId: string;
    projectId?: string | null;
    cursor?: string | null;
    limit?: number;
    archived?: boolean;
    searchTerm: string;
  }): Promise<HomeThreadSearchResult> {
    const member = await this.ensureKnownMember(input.memberId);
    const workspace = input.projectId
      ? await requireHomeProjectWorkspace(member, this.requireHomeProject(input.memberId, input.projectId).projectId)
      : member.layout.workspace;
    const imported = homeProjectImportedIndex(
      member,
      await readImportedConversationIndex(member.layout),
      input.projectId ?? null,
    );
    const excluded = new Set([...roomMappedThreadIds(member), ...this.pendingImportThreadIds]);
    const searchThreads = this.options.searchThreads ?? runAppServerUnixThreadSearch;
    if (imported.records.length === 0) {
      const result = await searchThreads({
        socketPath: requireSocket(member), cursor: input.cursor, limit: input.limit,
        archived: input.archived, searchTerm: input.searchTerm, timeoutMs: 60_000,
      });
      return homeThreadSearchData(result, workspace, excluded);
    }
    const results = await collectNativeSearchPages(async (cursor) => searchThreads({
      socketPath: requireSocket(member), cursor, limit: 100,
      archived: input.archived, searchTerm: input.searchTerm, timeoutMs: 60_000,
    }));
    const all = overlayImportedThreadSummaries(homeThreadSearchData({ results, nextCursor: null, backwardsCursor: null }, workspace, excluded), imported);
    return paginateImportedThreadSummaries(all, input.cursor, input.limit);
  }

  async readHomeThread(memberId: string, threadId: string): Promise<HomeThreadReadResult> {
    const member = await this.ensureKnownMember(memberId);
    this.assertHomeThread(member, threadId);
    const branch = ensureHomeBranch(member, threadId, this.nowMs());
    const selectedThreadId = branch.selectedThreadId;
    this.assertHomeThread(member, selectedThreadId);
    const branches = homeBranches(member, branch.rootThreadId);
    const readThread = this.options.readThread ?? runAppServerUnixThreadRead;
    const results = await Promise.all(branches.map(async (candidate) => ({
      threadId: candidate.threadId,
      result: await readThread({
        socketPath: requireSocket(member),
        threadId: candidate.threadId,
        timeoutMs: 60_000,
      }),
    })));
    await this.persistMemberState(member);
    const result = homeThreadReadData(selectedThreadId, results, branches, member.layout.workspace);
    const imported = await readImportedConversationIndex(member.layout);
    result.turns = [
      ...imported.records.filter((record) => branches.some((branch) => branch.threadId === record.threadId)).flatMap(importedTurns),
      ...result.turns,
    ];
    for (const pending of this.pendingHomeQuestions.values()) {
      if (pending.memberId !== memberId) continue;
      const turn = result.turns.find((candidate) => (
        candidate.thread_id === pending.threadId && candidate.turn_id === pending.turnId
      ));
      if (turn && !(turn.snapshot.interactions ?? []).some((candidate) => candidate.id === pending.interaction.id)) {
        turn.snapshot.interactions = [...(turn.snapshot.interactions ?? []), pending.interaction];
      }
    }
    for (const entry of this.homeQuestionHistory.values()) {
      if (entry.memberId !== memberId) continue;
      const turn = result.turns.find((candidate) => (
        candidate.thread_id === entry.threadId && candidate.turn_id === entry.turnId
      ));
      if (turn && !(turn.snapshot.interactions ?? []).some((candidate) => candidate.id === entry.interaction.id)) {
        turn.snapshot.interactions = [...(turn.snapshot.interactions ?? []), entry.interaction];
      }
    }
    return result;
  }

  async forkHomeThread(
    input: HomeThreadForkInput & { memberId: string },
  ): Promise<HomeThreadForkResult> {
    try {
      await this.assertMemberNotTerminalPersisted(input.memberId);
      const member = await this.ensureKnownMember(input.memberId);
      this.assertHomeThread(member, input.thread_id);
      const initialSource = ensureHomeBranch(member, input.thread_id, this.nowMs());
      const result = await this.withHomeMutationLock(
        `${input.memberId}\0${initialSource.rootThreadId}`,
        async () => {
          const fingerprint = JSON.stringify({
            thread_id: input.thread_id,
            anchor_turn_id: input.anchor_turn_id,
            kind: input.kind,
            prompt: input.prompt ?? null,
            expected_revision: input.expected_revision,
          });
          const replay = this.readHomeMutationReceipt<HomeThreadForkResult>(
            input.memberId,
            input.idempotency_key,
            fingerprint,
            "fork",
          );
          if (replay) return replay;
          const source = member.threads.get(`home:${input.thread_id}`)?.homeBranch;
          const sourceRecord = member.threads.get(`home:${input.thread_id}`);
          if (!source || source.rootThreadId !== initialSource.rootThreadId) {
            throw new MemberRuntimeError("home_thread_not_found", "Home Thread branch does not exist.");
          }
          if (source.revision !== input.expected_revision) {
            throw new MemberRuntimeError("home_thread_revision_conflict", "Home Thread revision changed.");
          }
          const raw = await (this.options.readThread ?? runAppServerUnixThreadRead)({
            socketPath: requireSocket(member),
            threadId: input.thread_id,
            timeoutMs: 60_000,
          });
          assertHomeTurnExists(raw.thread, input.anchor_turn_id);
          let forkedThreadId: string;
          let turnId: string | null = null;
          if (input.kind === "explicit") {
            const forked = await (this.options.forkThread ?? runAppServerUnixThreadFork)({
              socketPath: requireSocket(member),
              parentThreadId: input.thread_id,
              lastTurnId: input.anchor_turn_id,
              timeoutMs: input.timeout_ms ?? 60_000,
            });
            forkedThreadId = forked.threadId;
          } else {
            const prompt = input.kind === "edited_user_message"
              ? input.prompt
              : homeTurnPrompt(raw.thread, input.anchor_turn_id);
            if (!prompt) {
              throw new MemberRuntimeError("home_fork_prompt_missing", "Home fork requires a user prompt.");
            }
            const turn = await this.runTurn(member, {
              prompt,
              codexThreadId: null,
              forkParentThreadId: input.thread_id,
              forkBeforeTurnId: input.anchor_turn_id,
              clientUserMessageId: `home-fork:${input.idempotency_key}`,
              cwd: sourceRecord?.workspaceRoots[0] ?? member.layout.workspace,
              workspaceRoots: sourceRecord?.workspaceRoots ?? [member.layout.workspace],
              developerInstructions: sourceRecord?.homeProjectId ? HOME_PROJECT_DEVELOPER_INSTRUCTIONS : null,
              timeoutMs: input.timeout_ms,
              eventScope: { type: "home" },
              beforeTurnStart: ({ threadId }) => this.assertHomeThread(member, threadId),
            });
            if (!turn.threadId) {
              throw new MemberRuntimeError("codex_thread_missing", "Codex fork did not return a Thread id.");
            }
            forkedThreadId = turn.threadId;
            turnId = turn.turnId;
          }
          if (!forkedThreadId) {
            throw new MemberRuntimeError("codex_thread_missing", "Codex fork did not return a Thread id.");
          }
          const revision = source.revision + 1;
          updateHomeBranchSelection(member, source.rootThreadId, forkedThreadId, revision);
          member.threads.set(`home:${forkedThreadId}`, {
            key: `home:${forkedThreadId}`,
            roomId: null,
            threadId: forkedThreadId,
            workspaceRoots: sourceRecord?.workspaceRoots ?? [member.layout.workspace],
            homeProjectId: sourceRecord?.homeProjectId ?? null,
            homeBranch: {
              rootThreadId: source.rootThreadId,
              sourceThreadId: input.thread_id,
              anchorTurnId: input.anchor_turn_id,
              kind: input.kind,
              selectedThreadId: forkedThreadId,
              revision,
              createdAtMs: this.nowMs(),
            },
          });
          const result: HomeThreadForkResult = {
            submitted: true,
            root_thread_id: source.rootThreadId,
            source_thread_id: input.thread_id,
            thread_id: forkedThreadId,
            turn_id: turnId,
            revision,
          };
          this.writeHomeMutationReceipt(input.memberId, input.idempotency_key, fingerprint, {
            type: "fork",
            ...result,
          });
          await this.persistMemberState(member);
          return result;
        },
      );
      emitLifecycleEvent("codex.home.thread.fork", {
        result: "succeeded",
        code: input.kind,
        retryable: false,
        "fields.actor_id": input.memberId,
        "fields.thread_id": result.thread_id,
      });
      return result;
    } catch (error) {
      emitLifecycleEvent("codex.home.thread.fork", {
        result: "failed",
        code: runtimeErrorCode(error, "home_thread_fork_failed"),
        retryable: runtimeErrorRetryable(error),
        "fields.actor_id": input.memberId,
        "fields.thread_id": input.thread_id,
      });
      throw error;
    }
  }

  async selectHomeThread(input: {
    memberId: string;
    rootThreadId: string;
    threadId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<HomeThreadSelectResult> {
    try {
      await this.assertMemberNotTerminalPersisted(input.memberId);
      const member = await this.ensureKnownMember(input.memberId);
      const result = await this.withHomeMutationLock(`${input.memberId}\0${input.rootThreadId}`, async () => {
        const fingerprint = JSON.stringify({
          root_thread_id: input.rootThreadId,
          thread_id: input.threadId,
          expected_revision: input.expectedRevision,
        });
        const replay = this.readHomeMutationReceipt<HomeThreadSelectResult>(
          input.memberId,
          input.idempotencyKey,
          fingerprint,
          "select",
        );
        if (replay) return replay;
        const root = member.threads.get(`home:${input.rootThreadId}`)?.homeBranch
        ?? homeBranches(member, input.rootThreadId)[0]?.homeBranch;
        const selected = member.threads.get(`home:${input.threadId}`)?.homeBranch;
        if (
          !root
        || !selected
        || root.rootThreadId !== input.rootThreadId
        || selected.rootThreadId !== input.rootThreadId
        || root.revision !== input.expectedRevision
        ) {
          throw new MemberRuntimeError("home_thread_revision_conflict", "Home Thread selection revision changed.");
        }
        const revision = root.revision + 1;
        updateHomeBranchSelection(member, input.rootThreadId, input.threadId, revision);
        const result: HomeThreadSelectResult = {
          root_thread_id: input.rootThreadId,
          selected_thread_id: input.threadId,
          revision,
        };
        this.writeHomeMutationReceipt(input.memberId, input.idempotencyKey, fingerprint, {
          type: "select",
          ...result,
        });
        await this.persistMemberState(member);
        return result;
      });
      emitLifecycleEvent("codex.home.thread.select", {
        result: "succeeded",
        code: "selected",
        retryable: false,
        "fields.actor_id": input.memberId,
        "fields.thread_id": result.selected_thread_id,
      });
      return result;
    } catch (error) {
      emitLifecycleEvent("codex.home.thread.select", {
        result: "failed",
        code: runtimeErrorCode(error, "home_thread_select_failed"),
        retryable: runtimeErrorRetryable(error),
        "fields.actor_id": input.memberId,
        "fields.thread_id": input.threadId,
      });
      throw error;
    }
  }

  async deleteHomeThread(input: {
    memberId: string;
    threadId: string;
    confirmation: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<HomeThreadDeleteResult> {
    try {
      await this.assertMemberNotTerminalPersisted(input.memberId);
      const member = await this.ensureKnownMember(input.memberId);
      const fingerprint = JSON.stringify({
        thread_id: input.threadId,
        confirmation: input.confirmation,
        expected_revision: input.expectedRevision,
      });
      const replay = this.readHomeMutationReceipt<HomeThreadDeleteResult>(
        input.memberId,
        input.idempotencyKey,
        fingerprint,
        "delete",
      );
      if (replay) {
        emitLifecycleEvent("codex.home.thread.delete", {
          result: "succeeded",
          code: "replayed",
          retryable: false,
          "fields.actor_id": input.memberId,
          "fields.thread_id": input.threadId,
        });
        return replay;
      }
      const initialBranch = member.threads.get(`home:${input.threadId}`)?.homeBranch
        ?? ensureHomeBranch(member, input.threadId, this.nowMs());
      const result = await this.withHomeMutationLock(`${input.memberId}\0${initialBranch.rootThreadId}`, async () => {
        const lockedReplay = this.readHomeMutationReceipt<HomeThreadDeleteResult>(
          input.memberId,
          input.idempotencyKey,
          fingerprint,
          "delete",
        );
        if (lockedReplay) return lockedReplay;
        if (input.confirmation !== input.threadId) {
          throw new MemberRuntimeError("home_thread_delete_confirmation_invalid", "Home Thread deletion was not confirmed.");
        }
        const branch = member.threads.get(`home:${input.threadId}`)?.homeBranch;
        if (!branch || branch.rootThreadId !== initialBranch.rootThreadId) {
          throw new MemberRuntimeError("home_thread_not_found", "Home Thread branch does not exist.");
        }
        if (branch.revision !== input.expectedRevision) {
          throw new MemberRuntimeError("home_thread_revision_conflict", "Home Thread revision changed.");
        }
        await (this.options.deleteThread ?? runAppServerUnixThreadDelete)({
          socketPath: requireSocket(member),
          threadId: input.threadId,
          timeoutMs: 60_000,
        });
        member.threads.delete(`home:${input.threadId}`);
        await removeImportedThreadFromIndex(member.layout, input.threadId);
        const remaining = homeBranches(member, branch.rootThreadId);
        if (remaining.length > 0 && branch.selectedThreadId === input.threadId) {
          const next = remaining.find((candidate) => candidate.threadId === branch.rootThreadId)
          ?? remaining[0]!;
          updateHomeBranchSelection(member, branch.rootThreadId, next.threadId, branch.revision + 1);
        }
        const result: HomeThreadDeleteResult = { thread_id: input.threadId, deleted: true };
        this.writeHomeMutationReceipt(input.memberId, input.idempotencyKey, fingerprint, {
          type: "delete",
          ...result,
        });
        await this.persistMemberState(member);
        return result;
      });
      emitLifecycleEvent("codex.home.thread.delete", {
        result: "succeeded",
        code: "deleted",
        retryable: false,
        "fields.actor_id": input.memberId,
        "fields.thread_id": result.thread_id,
      });
      return result;
    } catch (error) {
      emitLifecycleEvent("codex.home.thread.delete", {
        result: "failed",
        code: runtimeErrorCode(error, "home_thread_delete_failed"),
        retryable: runtimeErrorRetryable(error),
        "fields.actor_id": input.memberId,
        "fields.thread_id": input.threadId,
      });
      throw error;
    }
  }

  private assertHomeThread(member: ManagedMember, threadId: string): void {
    if (roomMappedThreadIds(member).has(threadId)) {
      throw new MemberRuntimeError(
        "home_thread_room_mapped",
        "Room Threads are unavailable from Home.",
      );
    }
  }

  dispatchAgentRoomExecution(input: AgentRoomExecutionInput): Promise<AgentRoomExecutionResult> {
    this.assertOpen();
    const existing = this.executionFlights.get(input.idempotencyKey);
    if (existing) return existing;
    try {
      this.assertMemberNotTerminal(input.memberId);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.switchingMembers.has(input.memberId)) {
      return Promise.reject(new MemberRuntimeError(
        "member_executor_switching",
        "Member Executor is switching; new turns are paused.",
        { retryable: true, details: { member_id: input.memberId } },
      ));
    }
    const admission = this.assertMemberNotTerminalPersisted(input.memberId);
    this.trackMemberDispatchAdmission(input.memberId, admission);
    return this.dispatchAgentRoomExecutionChecked(input, admission);
  }

  private dispatchAgentRoomExecutionChecked(
    input: AgentRoomExecutionInput,
    admission: Promise<void>,
  ): Promise<AgentRoomExecutionResult> {
    const existing = this.executionFlights.get(input.idempotencyKey);
    if (existing) return existing;

    const chainKey = `${input.memberId}\0${input.agentRoomThreadKey}`;
    const previous = this.threadChains.get(chainKey) ?? Promise.resolve();
    let resolveResult!: (value: AgentRoomExecutionResult) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<AgentRoomExecutionResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        await admission;
        await this.hydratePersistedExecutions(input.memberId);
        const completed = this.executionResults.get(input.idempotencyKey);
        return completed
          ? { ...completed, replayed: true }
          : this.runAgentRoomExecution(input);
      })
      .then(resolveResult, rejectResult)
      .finally(() => {
        if (this.threadChains.get(chainKey) === task) this.threadChains.delete(chainKey);
      });
    this.threadChains.set(chainKey, task);
    this.executionFlights.set(input.idempotencyKey, result);
    this.executionMembers.set(input.idempotencyKey, input.memberId);
    void result.finally(() => {
      if (this.executionFlights.get(input.idempotencyKey) === result) {
        this.executionFlights.delete(input.idempotencyKey);
        this.executionMembers.delete(input.idempotencyKey);
      }
    }).catch(() => undefined);
    return result;
  }

  async pendingAgentRoomExecutionCompletions(): Promise<PendingAgentRoomExecutionCompletion[]> {
    const layout = await ensureCompanyRuntimeLayout(this.workdir);
    for (const entry of await readdir(layout.members, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await this.hydratePersistedExecutions(entry.name);
      }
    }
    return [...this.pendingExecutionCompletions.values()].map((pending) => ({
      memberId: pending.memberId,
      completion: cloneExecutionCompletion(pending.completion),
    }));
  }

  async persistPendingAgentRoomExecutionCompletion(
    memberId: string,
    completion: AgentRoomExecutionCompletion,
  ): Promise<void> {
    if (await this.isMemberTerminalPersisted(memberId)) return;
    await this.hydratePersistedExecutions(memberId);
    this.pendingExecutionCompletions.set(completion.idempotency_key, {
      memberId,
      completion: cloneExecutionCompletion(completion),
    });
    await this.persistMemberStateById(memberId);
  }

  async markAgentRoomExecutionCompletionDelivered(
    memberId: string,
    idempotencyKey: string,
  ): Promise<void> {
    if (await this.isMemberTerminalPersisted(memberId)) return;
    await this.hydratePersistedExecutions(memberId);
    const pending = this.pendingExecutionCompletions.get(idempotencyKey);
    if (!pending || pending.memberId !== memberId) return;
    this.pendingExecutionCompletions.delete(idempotencyKey);
    const result = this.executionResults.get(idempotencyKey);
    if (result?.memberId === memberId) {
      this.executionResults.set(idempotencyKey, { ...result, completionPending: false });
    }
    await this.persistMemberStateById(memberId);
  }

  trackAgentRoomExecutionCompletionDelivery(
    memberId: string,
    delivery: Promise<void>,
  ): void {
    const deliveries = this.completionDeliveryFlights.get(memberId) ?? new Set();
    deliveries.add(delivery);
    this.completionDeliveryFlights.set(memberId, deliveries);
    void delivery.finally(() => {
      deliveries.delete(delivery);
      if (deliveries.size === 0 && this.completionDeliveryFlights.get(memberId) === deliveries) {
        this.completionDeliveryFlights.delete(memberId);
      }
    }).catch(() => undefined);
  }

  async respondAgentRoomInteraction(
    dispatch: AgentRoomInteractionResponseDispatch,
  ): Promise<AgentRoomInteractionResponseAccepted> {
    this.assertOpen();
    const fingerprint = interactionResponseFingerprint(dispatch);
    const completed = this.interactionResponses.get(dispatch.idempotency_key);
    if (completed) {
      assertInteractionResponseFingerprint(completed.fingerprint, fingerprint);
      return { ...completed.result, duplicate: true };
    }
    const inFlight = this.interactionResponseFlights.get(dispatch.idempotency_key);
    if (inFlight) {
      assertInteractionResponseFingerprint(inFlight.fingerprint, fingerprint);
      const result = await inFlight.promise;
      return { ...result, duplicate: true };
    }
    let pending = this.pendingInteractions.get(dispatch.interaction_id);
    if (!pending) {
      await this.waitForInteractionBinding(dispatch);
      pending = this.pendingInteractions.get(dispatch.interaction_id);
    }
    if (
      !pending
      || pending.executionId !== dispatch.execution_id
      || pending.roomId !== dispatch.room_id
      || pending.memberId !== dispatch.agent_member_id
      || pending.state !== "pending"
    ) {
      throw new MemberRuntimeError(
        "interaction_not_pending",
        "The Agent-Room interaction is not pending in this Runtime process.",
      );
    }
    pending.state = "responding";
    const promise = (async (): Promise<AgentRoomInteractionResponseAccepted> => {
      try {
        const resolvedKey = roomRequestKey(pending.executionId, pending.requestId);
        this.resolvedRoomInteractionIds.set(resolvedKey, pending.interactionId);
        while (this.resolvedRoomInteractionIds.size > INTERACTION_RESPONSE_CACHE_LIMIT) {
          const oldest = this.resolvedRoomInteractionIds.keys().next().value as string | undefined;
          if (!oldest) break;
          this.resolvedRoomInteractionIds.delete(oldest);
        }
        await pending.respond(codexInteractionResponse(
          pending.method,
          pending.payload,
          dispatch.response,
        ));
        this.pendingInteractions.delete(dispatch.interaction_id);
        const result: AgentRoomInteractionResponseAccepted = {
          accepted: true,
          persisted_response_id: dispatch.persisted_response_id,
          idempotency_key: dispatch.idempotency_key,
          duplicate: false,
        };
        this.rememberInteractionResponse(dispatch.idempotency_key, {
          memberId: pending.memberId,
          fingerprint,
          result,
        });
        return result;
      } catch (error) {
        this.resolvedRoomInteractionIds.delete(roomRequestKey(pending.executionId, pending.requestId));
        pending.state = "pending";
        throw error;
      }
    })().finally(() => {
      if (this.interactionResponseFlights.get(dispatch.idempotency_key)?.promise === promise) {
        this.interactionResponseFlights.delete(dispatch.idempotency_key);
      }
    });
    this.interactionResponseFlights.set(dispatch.idempotency_key, {
      memberId: pending.memberId,
      fingerprint,
      promise,
    });
    return promise;
  }

  cleanupMember(
    operationId: string,
    memberId: string,
  ): Promise<CompanyRuntimeMemberCleanupResult> {
    this.assertOpen();
    memberWorkspaceLayout(this.workdir, memberId);
    const existingOperation = this.memberCleanupOperations.get(operationId);
    if (existingOperation) {
      this.assertCleanupOperationMember(operationId, existingOperation.memberId, memberId);
      return existingOperation.promise.then(() => cleanupResult(operationId, memberId, true));
    }
    const existingMember = this.memberCleanupFlights.get(memberId);
    if (existingMember) {
      const joined = existingMember.promise.then(async () => {
        await writeMemberCleanupReceipt(this.workdir, { operationId, memberId });
        return cleanupResult(operationId, memberId, false);
      });
      const flight = { memberId, promise: joined };
      this.memberCleanupOperations.set(operationId, flight);
      void joined.catch(() => {
        this.memberCleanupOperations.delete(operationId);
      });
      return joined;
    }

    this.cleanupRequestedMembers.add(memberId);
    const promise = this.cleanupMemberAfterAdmissions(operationId, memberId);
    const flight = { memberId, promise };
    this.memberCleanupFlights.set(memberId, flight);
    this.memberCleanupOperations.set(operationId, flight);
    void promise.catch(() => {
      this.memberCleanupOperations.delete(operationId);
    }).finally(() => {
      if (this.memberCleanupFlights.get(memberId) === flight) {
        this.memberCleanupFlights.delete(memberId);
      }
      this.cleanupRequestedMembers.delete(memberId);
      this.cleaningMembers.delete(memberId);
    });
    return promise;
  }

  async switchMemberExecutor(
    memberId: string,
    target: RuntimeExecutorTarget,
    authoritativeThreadIds?: string[],
  ): Promise<MemberExecutorSwitchResult> {
    this.assertOpen();
    await this.assertMemberNotTerminalPersisted(memberId);
    this.assertMemberNotTerminal(memberId);
    const existing = this.memberSwitchFlights.get(memberId);
    if (existing) return existing;
    this.switchingMembers.add(memberId);
    const flight = this.switchMemberExecutorOnce(memberId, target, authoritativeThreadIds).finally(() => {
      this.switchingMembers.delete(memberId);
      if (this.memberSwitchFlights.get(memberId) === flight) {
        this.memberSwitchFlights.delete(memberId);
      }
    });
    this.memberSwitchFlights.set(memberId, flight);
    return flight;
  }

  async activateExecutorCredential(executorId: string, credentialVersion: number): Promise<void> {
    this.rotatingExecutors.add(executorId);
    const snapshots = [...this.members.values()]
      .filter((member) => member.executorId === executorId && member.state === "running")
      .map((member) => ({
        member,
        threads: [...member.threads.values()].map((thread) => ({
          ...thread,
          workspaceRoots: [...thread.workspaceRoots],
        })),
      }));
    if (snapshots.length === 0) {
      this.rotatingExecutors.delete(executorId);
      return;
    }
    this.credentialRotationSnapshots.set(executorId, snapshots);
    for (const snapshot of snapshots) {
      this.switchingMembers.add(snapshot.member.layout.memberId);
      snapshot.member.switching = true;
      snapshot.member.state = "switching";
    }
    await Promise.allSettled(snapshots.flatMap(({ member }) => [...member.activeExecutions]));
    await Promise.all(snapshots.map(({ member }) => this.stopManagedMember(member)));
    const replacements: ManagedMember[] = [];
    try {
      for (const snapshot of snapshots) {
        const replacement = await this.startManagedMember(
          snapshot.member.layout,
          {
            executorId,
            credentialVersion,
            memoryEnabled: snapshot.member.memoryEnabled,
            memoryManaged: snapshot.member.memoryManaged,
            memoryModel: snapshot.member.memoryModel ?? undefined,
          },
          snapshot.threads,
          "executor_switch",
        );
        await this.resumeRegisterAndPersistStartedMember(
          replacement,
          snapshot.threads,
          snapshot.member,
        );
        replacements.push(replacement);
      }
      this.credentialRotationSnapshots.delete(executorId);
      this.rotatingExecutors.delete(executorId);
      for (const snapshot of snapshots) {
        this.switchingMembers.delete(snapshot.member.layout.memberId);
      }
    } catch (error) {
      let stopError: unknown = null;
      for (const member of replacements) {
        try {
          await this.stopManagedMember(member);
        } catch (candidate) {
          member.state = "failed";
          member.plugin = null;
          this.members.set(member.layout.memberId, member);
          stopError ??= candidate;
        }
      }
      if (stopError) throw activationCleanupError(error, stopError);
      throw error;
    }
  }

  async rollbackExecutorCredential(executorId: string, credentialVersion: number): Promise<void> {
    const snapshots = this.credentialRotationSnapshots.get(executorId) ?? [];
    try {
      for (const snapshot of snapshots) {
        const current = this.members.get(snapshot.member.layout.memberId);
        if (
          current === snapshot.member
          && current.socketPath !== null
          && current.pid !== null
        ) {
          current.state = "running";
          current.switching = false;
          await this.persistMemberState(current);
          continue;
        }
        if (current && current !== snapshot.member) {
          await this.stopManagedMember(current);
        }
        const restored = await this.startManagedMember(
          snapshot.member.layout,
          {
            executorId,
            credentialVersion,
            memoryEnabled: snapshot.member.memoryEnabled,
            memoryManaged: snapshot.member.memoryManaged,
            memoryModel: snapshot.member.memoryModel ?? undefined,
          },
          snapshot.threads,
          "executor_switch",
        );
        await this.resumeRegisterAndPersistStartedMember(
          restored,
          snapshot.threads,
          current ?? snapshot.member,
        );
      }
    } finally {
      this.credentialRotationSnapshots.delete(executorId);
      this.rotatingExecutors.delete(executorId);
      for (const snapshot of snapshots) {
        this.switchingMembers.delete(snapshot.member.layout.memberId);
      }
    }
  }

  async prepareCompanyProxyChange(): Promise<void> {
    if (this.proxyRotationSnapshots) {
      throw new Error("company_proxy_reconfigure_in_progress");
    }
    const snapshots = [...this.members.values()]
      .filter((member) => member.state === "running")
      .map((member) => ({
        member,
        threads: [...member.threads.values()].map((thread) => ({
          ...thread,
          workspaceRoots: [...thread.workspaceRoots],
        })),
      }));
    this.proxyRotationSnapshots = snapshots;
    for (const snapshot of snapshots) {
      this.switchingMembers.add(snapshot.member.layout.memberId);
      snapshot.member.switching = true;
      snapshot.member.state = "switching";
    }
    await Promise.allSettled(snapshots.flatMap(({ member }) => [...member.activeExecutions]));
    await Promise.all(snapshots.map(({ member }) => this.stopManagedMember(member)));
  }

  async activateCompanyProxyChange(): Promise<void> {
    const snapshots = this.proxyRotationSnapshots ?? [];
    const replacements: ManagedMember[] = [];
    try {
      for (const snapshot of snapshots) {
        const replacement = await this.startManagedMember(
          snapshot.member.layout,
          {
            executorId: snapshot.member.executorId,
            credentialVersion: snapshot.member.credentialVersion,
            memoryEnabled: snapshot.member.memoryEnabled,
            memoryManaged: snapshot.member.memoryManaged,
            memoryModel: snapshot.member.memoryModel ?? undefined,
          },
          snapshot.threads,
          "executor_switch",
        );
        await this.resumeRegisterAndPersistStartedMember(
          replacement,
          snapshot.threads,
          snapshot.member,
        );
        replacements.push(replacement);
      }
      this.finishCompanyProxyChange(snapshots);
    } catch (error) {
      for (const member of replacements) {
        await this.stopManagedMember(member).catch(() => undefined);
      }
      throw error;
    }
  }

  async rollbackCompanyProxyChange(): Promise<void> {
    const snapshots = this.proxyRotationSnapshots ?? [];
    try {
      for (const snapshot of snapshots) {
        const current = this.members.get(snapshot.member.layout.memberId);
        if (
          current === snapshot.member
          && current.socketPath !== null
          && current.pid !== null
        ) {
          current.state = "running";
          current.switching = false;
          await this.persistMemberState(current);
          continue;
        }
        if (current && current !== snapshot.member) {
          await this.stopManagedMember(current).catch(() => undefined);
        }
        const restored = await this.startManagedMember(
          snapshot.member.layout,
          {
            executorId: snapshot.member.executorId,
            credentialVersion: snapshot.member.credentialVersion,
            memoryEnabled: snapshot.member.memoryEnabled,
            memoryManaged: snapshot.member.memoryManaged,
            memoryModel: snapshot.member.memoryModel ?? undefined,
          },
          snapshot.threads,
          "executor_switch",
        );
        await this.resumeRegisterAndPersistStartedMember(
          restored,
          snapshot.threads,
          current ?? snapshot.member,
        );
      }
    } finally {
      this.finishCompanyProxyChange(snapshots);
    }
  }

  private finishCompanyProxyChange(snapshots: CredentialRotationSnapshot[]): void {
    this.proxyRotationSnapshots = null;
    for (const snapshot of snapshots) {
      this.switchingMembers.delete(snapshot.member.layout.memberId);
    }
  }

  async stopIdleMembers(nowMs = this.nowMs()): Promise<string[]> {
    const stopped: string[] = [];
    for (const member of this.members.values()) {
      if (
        member.state !== "running"
        || member.switching
        || this.cleaningMembers.has(member.layout.memberId)
        || this.terminalMembers.has(member.layout.memberId)
        || member.activeExecutions.size > 0
        || nowMs - member.lastActivityAtMs < this.idleTimeoutMs
      ) {
        continue;
      }
      await this.stopManagedMember(member);
      stopped.push(member.layout.memberId);
    }
    return stopped;
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    for (const waiter of this.activityRetryWaiters) {
      clearTimeout(waiter.handle);
      waiter.resolve();
    }
    this.activityRetryWaiters.clear();
    if (this.idleTimer !== null) {
      (this.options.clearInterval ?? clearInterval)(this.idleTimer);
      this.idleTimer = null;
    }
    await Promise.allSettled([
      ...this.executionFlights.values(),
      ...this.memberSwitchFlights.values(),
      ...this.memberStartFlights.values(),
      ...[...this.memberDispatchAdmissions.values()].flatMap((admissions) => [...admissions]),
      ...[...this.interactionResponseFlights.values()].map((flight) => flight.promise),
      ...[...this.completionDeliveryFlights.values()].flatMap((flights) => [...flights]),
      ...this.stateWriteChains.values(),
    ]);
    const failures: unknown[] = [];
    for (const member of this.members.values()) {
      try {
        await this.stopManagedMember(member);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Company Runtime could not stop every Member App Server.");
    }
    this.pendingInteractions.clear();
  }

  private async cleanupMemberOnce(
    operationId: string,
    memberId: string,
  ): Promise<CompanyRuntimeMemberCleanupResult> {
    await Promise.allSettled([
      ...optionalPromise(this.memberStartFlights.get(memberId)),
      ...optionalPromise(this.memberSwitchFlights.get(memberId)),
    ]);
    await this.drainMemberWork(memberId);

    const member = this.members.get(memberId);
    if (member) {
      await this.stopManagedMember(member);
    }
    await this.drainMemberWork(memberId);
    await Promise.allSettled(optionalPromise(this.stateWriteChains.get(memberId)));

    this.clearMemberRuntimeState(memberId);
    await removeMemberWorkspace(this.workdir, memberId);
    await writeMemberTerminalMarker(this.workdir, {
      operationId,
      memberId,
      state: "completed",
    });
    await writeMemberCleanupReceipt(this.workdir, { operationId, memberId });
    return cleanupResult(operationId, memberId, false);
  }

  private async cleanupMemberAfterAdmissions(
    operationId: string,
    memberId: string,
  ): Promise<CompanyRuntimeMemberCleanupResult> {
    await Promise.allSettled(this.memberDispatchAdmissions.get(memberId) ?? []);
    this.cleaningMembers.add(memberId);
    return this.cleanupMemberOperation(operationId, memberId);
  }

  private async cleanupMemberOperation(
    operationId: string,
    memberId: string,
  ): Promise<CompanyRuntimeMemberCleanupResult> {
    const receipt = await readMemberCleanupReceipt(this.workdir, operationId);
    if (receipt) {
      this.assertCleanupOperationMember(operationId, receipt.memberId, memberId);
      this.terminalMembers.add(memberId);
      return cleanupResult(operationId, memberId, true);
    }
    const terminalMarker = await readMemberTerminalMarker(this.workdir, memberId);
    if (terminalMarker?.state !== "completed") {
      await writeMemberTerminalMarker(this.workdir, {
        operationId,
        memberId,
        state: "cleaning",
      });
    }
    this.terminalMembers.add(memberId);
    return this.cleanupMemberOnce(operationId, memberId);
  }

  private async drainMemberWork(memberId: string): Promise<void> {
    while (true) {
      const member = this.members.get(memberId);
      const pending = [
        ...(member ? member.activeExecutions : []),
        ...[...this.executionFlights.entries()]
          .filter(([idempotencyKey]) => this.executionMembers.get(idempotencyKey) === memberId)
          .map(([, execution]) => execution),
        ...[...this.threadChains.entries()]
          .filter(([key]) => key.startsWith(`${memberId}\0`))
          .map(([, chain]) => chain),
        ...[...this.interactionResponseFlights.values()]
          .filter((flight) => flight.memberId === memberId)
          .map((flight) => flight.promise),
        ...(this.completionDeliveryFlights.get(memberId) ?? []),
      ];
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  private clearMemberRuntimeState(memberId: string): void {
    this.members.delete(memberId);
    this.homeProjectsByMember.delete(memberId);
    this.memberStartFlights.delete(memberId);
    this.memberSwitchFlights.delete(memberId);
    this.switchingMembers.delete(memberId);
    this.memberDispatchAdmissions.delete(memberId);
    for (const key of this.threadChains.keys()) {
      if (key.startsWith(`${memberId}\0`)) this.threadChains.delete(key);
    }
    for (const [idempotencyKey, executionMemberId] of this.executionMembers) {
      if (executionMemberId !== memberId) continue;
      this.executionMembers.delete(idempotencyKey);
      this.executionFlights.delete(idempotencyKey);
    }
    for (const [idempotencyKey, result] of this.executionResults) {
      if (result.memberId === memberId) this.executionResults.delete(idempotencyKey);
    }
    for (const [idempotencyKey, pending] of this.pendingExecutionCompletions) {
      if (pending.memberId === memberId) this.pendingExecutionCompletions.delete(idempotencyKey);
    }
    for (const [interactionId, interaction] of this.pendingInteractions) {
      if (interaction.memberId === memberId) this.pendingInteractions.delete(interactionId);
    }
    for (const [interactionId, interaction] of this.pendingHomeQuestions) {
      if (interaction.memberId === memberId) this.pendingHomeQuestions.delete(interactionId);
    }
    for (const [interactionId, interaction] of this.homeQuestionHistory) {
      if (interaction.memberId === memberId) this.homeQuestionHistory.delete(interactionId);
    }
    for (const [idempotencyKey, flight] of this.interactionResponseFlights) {
      if (flight.memberId === memberId) this.interactionResponseFlights.delete(idempotencyKey);
    }
    for (const [idempotencyKey, response] of this.interactionResponses) {
      if (response.memberId === memberId) this.interactionResponses.delete(idempotencyKey);
    }
    for (const [executionId, flights] of this.interactionBindingFlights) {
      for (const flight of flights) {
        if (flight.memberId !== memberId) continue;
        flight.resolve();
        flights.delete(flight);
      }
      if (flights.size === 0) this.interactionBindingFlights.delete(executionId);
    }
    this.hydratedMembers.delete(memberId);
    this.completionDeliveryFlights.delete(memberId);
    this.stateWriteChains.delete(memberId);
    this.turnEvents.clearMember(memberId);
  }

  private async runAgentRoomExecution(input: AgentRoomExecutionInput): Promise<AgentRoomExecutionResult> {
    const member = input.executor
      ? await this.ensureMember(input.memberId, input.executor, { allowSwitching: true, allowTerminal: true })
      : await this.ensureKnownMember(input.memberId, { allowSwitching: true, allowTerminal: true });
    if (
      (member.state !== "running" && member.state !== "switching")
      || member.socketPath === null
    ) {
      throw new MemberRuntimeError(
        "member_executor_switching",
        "Member Executor is switching; new turns are paused.",
        { retryable: true, details: { member_id: input.memberId } },
      );
    }
    let executionThreadKey = input.agentRoomThreadKey;
    let mapped = member.threads.get(executionThreadKey);
    if (mapped && mapped.roomId !== input.roomId) {
      recordRoomContextResolution("mismatch", mapped.threadId);
      throw new MemberRuntimeError(
        "mcp_room_context_mismatch",
        "The persisted Codex Thread mapping does not match the target Room.",
      );
    }
    if (
      mapped
      && input.codexThreadId
      && !input.regeneration
      && mapped.threadId !== input.codexThreadId
    ) {
      const selectedBranch = [...member.threads.values()].find((thread) => (
        thread.roomId === input.roomId
        && thread.threadId === input.codexThreadId
      ));
      if (!selectedBranch) {
        recordRoomContextResolution("mismatch", input.codexThreadId);
        throw new MemberRuntimeError(
          "mcp_room_context_mismatch",
          "The requested Codex Thread does not match any persisted Room branch.",
        );
      }
      executionThreadKey = `${input.agentRoomThreadKey}\0thread:${input.codexThreadId}`;
      mapped = {
        ...selectedBranch,
        key: executionThreadKey,
      };
      member.threads.set(executionThreadKey, mapped);
    }
    const requestedThreadId = input.regeneration
      ? null
      : mapped?.threadId ?? input.codexThreadId ?? null;
    const executionInputRoot = await materializeCompanyFileInputs(
      member.layout,
      input.executionId,
      input.companyFileInputs ?? [],
      this.nowMs(),
    );
    emitLifecycleEvent("company_files.execution_inputs.materialized", {
      "fields.actor_id": input.memberId,
      "fields.operation_id": input.executionId,
      "fields.file_count": input.companyFileInputs?.length ?? 0,
      "fields.byte_count": input.companyFileInputs?.reduce(
        (sum, file) => sum + file.size_bytes,
        0,
      ) ?? 0,
    });
    const workspaceRoots = executionInputRoot
      ? [member.layout.workspace, executionInputRoot]
      : [member.layout.workspace];
    const localImagePaths = executionInputRoot
      ? await companyFileImagePaths(executionInputRoot, input.companyFileInputs ?? [])
      : [];
    const execution = this.runTurn(member, {
      prompt: executionInputRoot
        ? withCompanyFileAttachmentContext(input.prompt, input.companyFileInputs ?? [], executionInputRoot)
        : input.prompt,
      localImagePaths,
      codexThreadId: requestedThreadId,
      forkParentThreadId: input.regeneration?.forkParentThreadId ?? null,
      forkBeforeTurnId: input.regeneration?.forkBeforeTurnId ?? null,
      clientUserMessageId: input.clientUserMessageId ?? null,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      workspaceRoots,
      timeoutMs: input.timeoutMs,
      eventScope: {
        type: "room",
        roomId: input.roomId,
        executionId: input.executionId,
      },
      beforeTurnStart: async ({ threadId, resumed }) => {
        await this.prepareRoomThreadForTurn(member, {
          key: executionThreadKey,
          roomId: input.roomId,
          roomContextKind: "agent_execution",
          threadId,
          workspaceRoots,
          resumed,
        });
      },
    });
    member.activeExecutions.add(execution);
    member.lastActivityAtMs = this.nowMs();
    let turn: CodexAppServerTurnResult;
    try {
      turn = await execution;
    } finally {
      member.activeExecutions.delete(execution);
      member.lastActivityAtMs = this.nowMs();
      if (executionInputRoot) {
        await removeExecutionInputRoot(executionInputRoot);
      }
    }
    if (!turn.threadId) {
      throw new MemberRuntimeError("codex_thread_missing", "Codex completed an Agent-Room turn without a Thread id.");
    }
    const thread: MemberThreadRecord = {
      key: executionThreadKey,
      roomId: input.roomId,
      roomContextKind: "agent_execution",
      threadId: turn.threadId,
      workspaceRoots: [member.layout.workspace],
    };
    member.threads.set(thread.key, thread);
    const finalAnswerMarkdown = turn.agentText.trim();
    const completion: AgentRoomExecutionCompletion | null = input.completion
      ? {
        execution_id: input.executionId,
        idempotency_key: input.idempotencyKey,
        cascade_id: input.completion.cascadeId,
        room_id: input.roomId,
        agent_member_id: input.memberId,
        status: "succeeded",
        codex_thread_id: turn.threadId,
        codex_turn_id: turn.turnId,
        consumed_through_sequence: input.completion.consumedThroughSequence,
        ...(finalAnswerMarkdown.length > 0
          ? { final_answer_markdown: finalAnswerMarkdown }
          : {}),
        error: null,
        completed_at_ms: input.completion.completedAtMs?.() ?? this.nowMs(),
      }
      : null;
    const result: AgentRoomExecutionResult = {
      executionId: input.executionId,
      idempotencyKey: input.idempotencyKey,
      memberId: input.memberId,
      roomId: input.roomId,
      agentRoomThreadKey: executionThreadKey,
      codexThreadId: turn.threadId,
      codexTurnId: turn.turnId,
      completed: turn.completed,
      agentText: turn.agentText,
      completion,
      completionPending: completion !== null,
      replayed: false,
    };
    this.executionResults.set(input.idempotencyKey, result);
    if (completion) {
      this.pendingExecutionCompletions.set(input.idempotencyKey, {
        memberId: input.memberId,
        completion,
      });
    }
    await this.persistMemberState(member);
    return result;
  }

  private async switchMemberExecutorOnce(
    memberId: string,
    target: RuntimeExecutorTarget,
    authoritativeThreadIds?: string[],
  ): Promise<MemberExecutorSwitchResult> {
    const current = this.members.get(memberId);
    if (!current) {
      const started = await this.ensureMember(
        memberId,
        target,
        { allowSwitching: true, allowTerminal: true },
      );
      const knownThreads = [...started.threads.values()].map((thread) => ({
        ...thread,
        workspaceRoots: [...thread.workspaceRoots],
      }));
      const knownById = new Map(knownThreads.map((thread) => [thread.threadId, thread]));
      const threads = authoritativeThreadIds === undefined
        ? knownThreads
        : [...new Set(authoritativeThreadIds)].map((threadId) => (
          knownById.get(threadId) ?? {
            key: `recovered:${threadId}`,
            roomId: null,
            threadId,
            workspaceRoots: [started.layout.workspace],
          }
        ));
      const alreadyResumed = new Set(knownThreads.map((thread) => thread.threadId));
      try {
        await this.resumeMemberThreads(
          started,
          threads.filter((thread) => !alreadyResumed.has(thread.threadId)),
        );
        started.threads = new Map(threads.map((thread) => [thread.key, thread]));
        await this.persistMemberState(started);
      } catch (error) {
        try {
          await this.stopManagedMember(started);
        } catch (stopError) {
          started.state = "failed";
          started.plugin = null;
          this.members.set(memberId, started);
          throw activationCleanupError(error, stopError);
        }
        if (this.members.get(memberId) === started) this.members.delete(memberId);
        throw error;
      }
      return {
        memberId,
        previousExecutorId: null,
        targetExecutorId: target.executorId,
        switched: true,
        rolledBack: false,
        threadIdsUnchanged: true,
        resumedThreadIds: threads.map((thread) => thread.threadId),
        errorCode: null,
      };
    }
    if (current.executorId === target.executorId && current.state === "running") {
      return {
        memberId,
        previousExecutorId: current.executorId,
        targetExecutorId: target.executorId,
        switched: true,
        rolledBack: false,
        threadIdsUnchanged: true,
        resumedThreadIds: [...current.threads.values()].map((thread) => thread.threadId),
        errorCode: null,
      };
    }

    const previousExecutor: RuntimeExecutorTarget = {
      executorId: current.executorId,
      credentialVersion: current.credentialVersion,
      memoryEnabled: current.memoryEnabled,
      memoryManaged: current.memoryManaged,
      memoryModel: current.memoryModel ?? undefined,
    };
    current.switching = true;
    current.state = "switching";
    await Promise.allSettled([
      ...current.activeExecutions,
      ...[...this.executionFlights.entries()]
        .filter(([idempotencyKey]) => this.executionMembers.get(idempotencyKey) === memberId)
        .map(([, execution]) => execution),
    ]);
    const knownThreads = [...current.threads.values()].map((thread) => ({
      ...thread,
      workspaceRoots: [...thread.workspaceRoots],
    }));
    const knownById = new Map(knownThreads.map((thread) => [thread.threadId, thread]));
    const threads = authoritativeThreadIds === undefined
      ? knownThreads
      : [...new Set(authoritativeThreadIds)].map((threadId) => (
        knownById.get(threadId) ?? {
          key: `recovered:${threadId}`,
          roomId: null,
          threadId,
          workspaceRoots: [current.layout.workspace],
        }
      ));
    await this.stopManagedMember(current);
    let replacement: ManagedMember | null = null;
    try {
      replacement = await this.startManagedMember(current.layout, target, threads, "executor_switch");
      await this.resumeRegisterAndPersistStartedMember(replacement, threads, current);
      return {
        memberId,
        previousExecutorId: previousExecutor.executorId,
        targetExecutorId: target.executorId,
        switched: true,
        rolledBack: false,
        threadIdsUnchanged: true,
        resumedThreadIds: threads.map((thread) => thread.threadId),
        errorCode: null,
      };
    } catch (switchError) {
      const failedCleanup = this.members.get(memberId);
      if (
        failedCleanup?.state === "failed"
        && failedCleanup.pid !== null
        && failedCleanup.socketPath !== null
      ) {
        throw switchError;
      }
      try {
        const restored = await this.startManagedMember(current.layout, previousExecutor, threads, "executor_switch");
        await this.resumeRegisterAndPersistStartedMember(restored, threads, current);
        return {
          memberId,
          previousExecutorId: previousExecutor.executorId,
          targetExecutorId: target.executorId,
          switched: false,
          rolledBack: true,
          threadIdsUnchanged: true,
          resumedThreadIds: threads.map((thread) => thread.threadId),
          errorCode: runtimeErrorCode(switchError),
        };
      } catch (rollbackError) {
        const failedRollback = this.members.get(memberId);
        if (
          failedRollback?.state !== "failed"
          || failedRollback.pid === null
          || failedRollback.socketPath === null
        ) {
          current.switching = false;
          current.state = "failed";
          this.members.set(memberId, current);
        }
        throw new MemberRuntimeError(
          "member_executor_switch_rollback_failed",
          "Member Executor switch failed and the previous App Server could not be restored.",
          {
            details: {
              member_id: memberId,
              switch_error: runtimeErrorCode(switchError),
              rollback_error: runtimeErrorCode(rollbackError),
            },
          },
        );
      }
    }
  }

  private async ensureMember(
    memberId: string,
    executor: RuntimeExecutorTarget,
    options: { allowSwitching?: boolean; allowTerminal?: boolean } = {},
  ): Promise<ManagedMember> {
    if (this.rotatingExecutors.has(executor.executorId)) {
      throw new MemberRuntimeError(
        "executor_credential_rotating",
        "Executor credentials are rotating.",
        { retryable: true },
      );
    }
    if (!options.allowTerminal) this.assertMemberNotTerminal(memberId);
    const existing = this.members.get(memberId);
    if (
      !options.allowSwitching
      && (this.switchingMembers.has(memberId) || existing?.switching)
    ) {
      throw new MemberRuntimeError("member_executor_switching", "Member Executor is switching.", { retryable: true });
    }
    if (
      options.allowSwitching
      && existing?.switching
      && existing.socketPath !== null
      && existing.pid !== null
    ) {
      return existing;
    }
    if (existing?.state === "running") {
      if (existing.executorId !== executor.executorId) {
        throw new MemberRuntimeError(
          "member_executor_mismatch",
          "Member App Server is running with a different Executor; use the atomic switch operation.",
          { details: { member_id: memberId, active_executor_id: existing.executorId } },
        );
      }
      existing.lastActivityAtMs = this.nowMs();
      return existing;
    }
    if (existing?.pid !== null && existing?.pid !== undefined && existing.socketPath !== null) {
      throw new MemberRuntimeError(
        "member_app_server_cleanup_required",
        "Member App Server cleanup must succeed before it can be activated again.",
        { retryable: true, details: { member_id: memberId } },
      );
    }
    const startFlight = this.memberStartFlights.get(memberId);
    if (startFlight) return startFlight;
    const flight = (async () => {
      const activationStartedAtMs = this.nowMs();
      let activationStage = "workspace";
      try {
        const layout = existing?.layout ?? await provisionMemberWorkspace(this.workdir, memberId);
        const persisted = existing ? null : await readMemberRuntimeState(layout);
        const threads = existing ? [...existing.threads.values()] : persisted!.threads;
        const importedIndex = await readImportedConversationIndex(layout);
        for (const imported of importedIndex.records) {
          if (threads.some((thread) => thread.threadId === imported.threadId)) continue;
          threads.push(importedMemberThreadRecord(imported, layout.workspace));
        }
        if (persisted) {
          this.homeProjectsByMember.set(memberId, new Map(
            persisted.projects.map((project) => [project.projectId, project]),
          ));
          for (const execution of persisted.executions) {
            this.executionResults.set(execution.idempotencyKey, execution);
          }
          for (const completion of persisted.pendingCompletions) {
            this.pendingExecutionCompletions.set(completion.idempotency_key, {
              memberId,
              completion,
            });
          }
          for (const receipt of persisted.homeMutationReceipts) {
            this.homeMutationReceipts.set(
              `${receipt.memberId}\0${receipt.idempotencyKey}`,
              receipt,
            );
          }
          for (const question of persisted.homeQuestions) {
            this.homeQuestionHistory.set(question.interaction.id, question);
          }
          this.hydratedMembers.add(memberId);
        }
        activationStage = "start";
        const started = await this.startManagedMember(layout, executor, threads, "app_server_start");
        activationStage = "resume";
        await this.resumeRegisterAndPersistStartedMember(started, threads, existing ?? null);
        this.scheduleConversationImportRecovery(started);
        recordMemberActivation({
          memberId,
          result: "succeeded",
          stage: "complete",
          durationMs: Math.max(0, this.nowMs() - activationStartedAtMs),
        });
        return started;
      } catch (error) {
        const stage = activationErrorStage(error) ?? activationStage;
        recordMemberActivation({
          memberId,
          result: "failed",
          stage,
          durationMs: Math.max(0, this.nowMs() - activationStartedAtMs),
          code: runtimeErrorCode(error, activationFailureCode(stage)),
        });
        throw error;
      }
    })().finally(() => {
      if (this.memberStartFlights.get(memberId) === flight) {
        this.memberStartFlights.delete(memberId);
      }
    });
    this.memberStartFlights.set(memberId, flight);
    return flight;
  }

  private async prepareRoomThreadForTurn(
    member: ManagedMember,
    input: {
      key: string;
      roomId: string;
      roomContextKind: "agent_execution" | "human_side_chat";
      threadId: string;
      workspaceRoots: string[];
      resumed: boolean;
    },
  ): Promise<void> {
    const matches = [...member.threads.values()].filter(
      (thread) => thread.threadId === input.threadId,
    );
    const roomIds = new Set(matches.map((thread) => thread.roomId));
    const keyed = member.threads.get(input.key);
    if (input.resumed) {
      if (
        !keyed
        || keyed.threadId !== input.threadId
        || keyed.roomId !== input.roomId
        || (keyed.roomContextKind ?? "agent_execution") !== input.roomContextKind
        || roomIds.size !== 1
        || !roomIds.has(input.roomId)
      ) {
        recordRoomContextResolution(
          roomIds.size > 1 ? "ambiguous" : "mismatch",
          input.threadId,
        );
        throw new MemberRuntimeError(
          roomIds.size > 1
            ? "mcp_room_context_ambiguous"
            : "mcp_room_context_mismatch",
          roomIds.size > 1
            ? "Room context is ambiguous for the resumed Codex Thread."
            : "The resumed Codex Thread mapping does not match the target Room.",
        );
      }
      recordRoomContextResolution("resolved", input.threadId);
      return;
    }
    if (matches.some((thread) => thread.roomId !== input.roomId)) {
      recordRoomContextResolution("ambiguous", input.threadId);
      throw new MemberRuntimeError(
        "mcp_room_context_ambiguous",
        "The new Codex Thread is already mapped to another Room.",
      );
    }
    const previous = member.threads.get(input.key);
    member.threads.set(input.key, {
      key: input.key,
      roomId: input.roomId,
      roomContextKind: input.roomContextKind,
      threadId: input.threadId,
      workspaceRoots: [...input.workspaceRoots],
    });
    try {
      await this.persistMemberState(member);
      recordRoomContextResolution("resolved", input.threadId);
    } catch (_error) {
      if (previous) member.threads.set(input.key, previous);
      else member.threads.delete(input.key);
      emitLifecycleEvent("codex.room_context.unused_thread", {
        code: "mcp_room_context_persist_failed",
        retryable: true,
        "fields.actor_id": member.layout.memberId,
        "fields.thread_id": input.threadId,
      });
      throw new MemberRuntimeError(
        "mcp_room_context_persist_failed",
        "The new Codex Thread mapping could not be persisted before the Turn.",
        { retryable: true },
      );
    }
  }

  private async startManagedMember(
    layout: MemberWorkspaceLayout,
    executor: RuntimeExecutorTarget,
    threads: MemberThreadRecord[],
    tokenReason: CompanyExecutorTokenIssueInput["reason"],
  ): Promise<ManagedMember> {
    const started = await this.startManagedMemberOnce(layout, executor, threads, tokenReason);
    const model = executor.memoryModel?.trim();
    if (executor.memoryManaged !== true || !model) return started;
    const target = { enabled: executor.memoryEnabled === true, model };
    if (!await nativeMemoryNeedsReconciliation(layout.codexHome, target)) return started;
    try {
      await reconcileNativeMemory({
        socketPath: requireSocket(started),
        codexHome: layout.codexHome,
        target,
      });
    } catch (error) {
      started.memoryEnabled = false;
      emitLifecycleEvent("codex.member_memory.reconcile", {
        result: "failed",
        code: runtimeErrorCode(error, "member_memory_apply_failed"),
        retryable: true,
        "fields.actor_id": layout.memberId,
      });
      return started;
    }
    await this.stopManagedMember(started);
    return this.startManagedMemberOnce(layout, executor, threads, tokenReason);
  }

  private async startManagedMemberOnce(
    layout: MemberWorkspaceLayout,
    executor: RuntimeExecutorTarget,
    threads: MemberThreadRecord[],
    tokenReason: CompanyExecutorTokenIssueInput["reason"],
  ): Promise<ManagedMember> {
    const memberAssets = this.options.resolveMemberAssets
      ? await activationStep(
        "configuration",
        "member_asset_profile_failed",
        () => this.options.resolveMemberAssets!(layout.memberId),
      )
      : null;
    const tokens = await activationStep(
      "credentials",
      "member_executor_credentials_failed",
      () => this.issueExecutorTokens(executor, tokenReason),
    );
    const pluginMarketplace = await activationStep(
      "marketplace",
      "fields_plugin_marketplace_activation_failed",
      () => this.prepareFieldsPluginMarketplace(),
    );
    await activationStep(
      "marketplace",
      "fields_plugin_marketplace_activation_failed",
      () => this.verifyPluginMarketplace(pluginMarketplace),
    );
    await activationStep(
      "configuration",
      "member_codex_configuration_failed",
      () => assertMemberCodexHomeCredentialFree(layout),
    );
    const customCredential = tokens.credential.type === "custom_api_key"
      ? tokens.credential
      : null;
    await activationStep(
      "configuration",
      "member_codex_configuration_failed",
      async () => {
        await configureCodexIntegration(layout.workspace, {
          customProvider: customCredential
            ? { baseUrl: customCredential.base_url, envKey: "FIELDS_EXECUTOR_API_KEY" }
            : undefined,
          assetMcps: memberAssets?.mcps ?? [],
          excludedSecretEnv: [FIELDS_MAIL_MCP_TOKEN_ENV],
        });
        await assertFieldsRoomMessagesNotGloballyEnabled(layout.workspace);
      },
    );
    const mailMcpToken = this.issueMailMcpToken(layout.memberId);
    const process = await activationStep(
      "process",
      "member_app_server_start_failed",
      () => (this.options.startProcess ?? startCodexAppServerProcess)(layout.workspace, {
        codexHomePath: layout.codexHome,
        memberId: layout.memberId,
        secretEnv: {
          ...this.options.proxyEnv?.(),
          ...memberAssets?.secretEnv,
          ...(customCredential
            ? { FIELDS_EXECUTOR_API_KEY: customCredential.api_key }
            : {}),
          [FIELDS_MAIL_MCP_TOKEN_ENV]: mailMcpToken,
        },
      }),
    ).catch((error) => {
      this.revokeMailMcpToken(layout.memberId);
      throw error;
    });
    let plugin: FieldsCorePluginHealth;
    let assetIssues = new Map<string, string>();
    try {
      await activationStep(
        "login",
        "member_app_server_login_failed",
        () => (this.options.login ?? loginMember)(process.socketPath, tokens),
      );
      plugin = await activationStep(
        "plugin",
        "fields_plugin_install_failed",
        () => (this.options.installPlugin ?? installFieldsCorePlugin)({
          socketPath: process.socketPath,
          marketplacePath: pluginMarketplace.marketplacePath,
          expectedVersion: pluginMarketplace.version,
        }),
      );
      if (memberAssets && this.options.activateMemberAssets) {
        assetIssues = await activationStep(
          "plugin",
          "member_asset_activation_failed",
          () => this.options.activateMemberAssets!(process.socketPath, memberAssets),
        );
      }
      await activationStep(
        "verification",
        "fields_plugin_activation_invalid",
        async () => {
          await assertMemberCodexHomeCredentialFree(layout);
          await assertFieldsRoomMessagesNotGloballyEnabled(layout.workspace);
        },
      );
    } catch (error) {
      this.revokeMailMcpToken(layout.memberId);
      try {
        await this.stopStartedProcess(layout, process.pid);
      } catch (stopError) {
        this.members.set(layout.memberId, {
          layout,
          executorId: tokens.executor_id,
          credentialVersion: tokens.credential_version,
          chatgptAccountId: tokens.credential.type === "chatgpt_auth_tokens"
            ? tokens.credential.account_id
            : null,
          socketPath: process.socketPath,
          pid: process.pid,
          state: "failed",
          lastActivityAtMs: this.nowMs(),
          activeExecutions: new Set(),
          threads: new Map(threads.map((thread) => [thread.key, thread])),
          switching: false,
          plugin: null,
          assetIssues: new Map(),
          memoryEnabled: executor.memoryEnabled ?? false,
          memoryManaged: executor.memoryManaged === true,
          memoryModel: executor.memoryModel ?? null,
        });
        throw activationCleanupError(error, stopError);
      }
      throw error;
    }
    return {
      layout,
      executorId: tokens.executor_id,
      credentialVersion: tokens.credential_version,
      chatgptAccountId: tokens.credential.type === "chatgpt_auth_tokens"
        ? tokens.credential.account_id
        : null,
      socketPath: process.socketPath,
      pid: process.pid,
      state: "running",
      lastActivityAtMs: this.nowMs(),
      activeExecutions: new Set(),
      threads: new Map(threads.map((thread) => [thread.key, thread])),
      switching: false,
      plugin,
      assetIssues,
      memoryEnabled: executor.memoryEnabled ?? false,
      memoryManaged: executor.memoryManaged === true,
      memoryModel: executor.memoryModel ?? null,
    };
  }

  builderScope(memberId: string, threadId: string): CompanyRuntimeBuilderScope | null {
    return this.builderScopes.get(builderScopeKey(memberId, threadId)) ?? null;
  }

  builderWorkspace(memberId: string, threadId: string): string | null {
    return this.builderWorkspaces.get(builderScopeKey(memberId, threadId)) ?? null;
  }

  private async resumeRegisterAndPersistStartedMember(
    member: ManagedMember,
    threads: MemberThreadRecord[],
    previous: ManagedMember | null,
  ): Promise<void> {
    try {
      await this.resumeMemberThreads(member, threads);
      this.members.set(member.layout.memberId, member);
      await this.persistMemberState(member);
    } catch (error) {
      try {
        await this.stopManagedMember(member);
      } catch (stopError) {
        member.state = "failed";
        member.switching = false;
        member.plugin = null;
        this.members.set(member.layout.memberId, member);
        throw activationCleanupError(error, stopError);
      }
      if (this.members.get(member.layout.memberId) === member) {
        if (previous) this.members.set(member.layout.memberId, previous);
        else this.members.delete(member.layout.memberId);
      }
      throw error;
    }
  }

  private async stopStartedProcess(
    layout: MemberWorkspaceLayout,
    pid: number,
  ): Promise<void> {
    const stopped = await (this.options.stopProcess ?? stopCodexAppServerProcess)(layout.workspace, {
      expectedPid: pid,
      requireOwned: true,
    });
    this.assertProcessTerminated(stopped);
  }

  private assertProcessTerminated(stopped: Record<string, unknown>): void {
    if (stopped.terminated !== true) {
      throw new MemberRuntimeError(
        "member_app_server_stop_failed",
        "Member App Server did not confirm termination.",
      );
    }
  }

  private async resumeMemberThreads(member: ManagedMember, threads: MemberThreadRecord[]): Promise<void> {
    if (member.socketPath === null) return;
    const resume = this.options.resumeThread ?? runAppServerUnixThreadResume;
    for (const thread of threads) {
      const resumed = await resume({
        socketPath: member.socketPath,
        threadId: thread.threadId,
        cwd: thread.workspaceRoots.length === 1
          ? thread.workspaceRoots[0]!
          : member.layout.workspace,
        runtimeWorkspaceRoots: withCompanyFilesCache(member.layout, thread.workspaceRoots),
        threadConfig: thread.roomId === null
          ? null
          : roomMessagesThreadConfig(),
      });
      if (resumed.threadId !== thread.threadId) {
        throw new MemberRuntimeError(
          "codex_thread_identity_changed",
          "Codex resumed a different Thread during App Server restart.",
          { details: { expected_thread_id: thread.threadId, actual_thread_id: resumed.threadId } },
        );
      }
    }
  }

  private async runTurn(
    member: ManagedMember,
    input: {
      prompt: string;
      localImagePaths?: string[];
      developerInstructions?: string | null;
      cwd?: string;
      codexThreadId: string | null;
      forkParentThreadId?: string | null;
      forkBeforeTurnId?: string | null;
      clientUserMessageId: string | null;
      model?: string | null;
      reasoningEffort?: string | null;
      workspaceRoots: string[];
      timeoutMs?: number;
      eventScope: { type: "home" } | {
        type: "room";
        roomId: string;
        executionId: string;
      } | {
        type: "room_side_chat";
        roomId: string;
        eventKey: string;
      };
      onHomeEvent?: (event: CodexAppServerRawEvent) => void;
      beforeTurnStart?: (input: { threadId: string; resumed: boolean }) => Promise<void> | void;
    },
  ): Promise<CodexAppServerTurnResult> {
    if (member.socketPath === null) {
      throw new MemberRuntimeError("member_app_server_stopped", "Member App Server is not running.", { retryable: true });
    }
    const roomInteractionIds = new Set<string>();
    try {
      const started = await (this.options.runTurn ?? runAppServerUnixTurnStream)({
        workdir: member.layout.workspace,
        socketPath: member.socketPath,
        prompt: input.prompt,
        localImagePaths: input.localImagePaths ?? [],
        developerInstructions: input.developerInstructions ?? null,
        codexThreadId: input.codexThreadId,
        forkParentThreadId: input.forkParentThreadId ?? null,
        forkBeforeTurnId: input.forkBeforeTurnId ?? null,
        clientUserMessageId: input.clientUserMessageId,
        model: input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        cwd: input.cwd ?? member.layout.workspace,
        runtimeWorkspaceRoots: withCompanyFilesCache(member.layout, input.workspaceRoots),
        threadConfig: input.eventScope.type === "room" || input.eventScope.type === "room_side_chat"
          ? roomMessagesThreadConfig()
          : null,
        timeoutMs: input.timeoutMs,
        beforeTurnStart: input.beforeTurnStart,
        onEvent: async (event) => {
          if (isUnauthorizedTurnCompletion(event)) {
            const key = `${member.executorId}\0${member.credentialVersion}`;
            for (const candidate of this.members.values()) {
              if (
                candidate.executorId === member.executorId
                && candidate.credentialVersion === member.credentialVersion
              ) {
                candidate.state = "auth_required";
              }
            }
            if (!this.unauthorizedCredentialVersions.has(key)) {
              this.unauthorizedCredentialVersions.add(key);
              await this.options.onExecutorUnauthorized?.({
                executorId: member.executorId,
                credentialVersion: member.credentialVersion,
              });
            }
          }
          if (input.eventScope.type === "home") {
            input.onHomeEvent?.(event);
            if (!event.threadId) return;
            const envelope = homeCodexRuntimeEvent(member.layout.memberId, event.threadId, event);
            if (envelope.type === "agent_runtime.interaction_request") {
              if (!event.respond || !event.turnId || envelope.method !== "item/tool/requestUserInput") {
                throw new MemberRuntimeError("question_interaction_invalid", "Codex emitted an invalid Home question request.");
              }
              const deadlineAtMs = envelope.occurred_at_ms + 90_000;
              this.pendingHomeQuestions.set(envelope.event_id, {
                interaction: questionInteractionFromPayload(
                  envelope.event_id,
                  envelope.item_id,
                  envelope.payload,
                  envelope.occurred_at_ms,
                  deadlineAtMs,
                ),
                memberId: member.layout.memberId,
                threadId: event.threadId,
                turnId: event.turnId,
                respond: event.respond,
                state: "pending",
              });
              this.homeQuestionHistory.set(envelope.event_id, {
                interaction: this.pendingHomeQuestions.get(envelope.event_id)!.interaction,
                memberId: member.layout.memberId,
                threadId: event.threadId,
                turnId: event.turnId,
              });
              this.scheduleHomeQuestionTimeout(envelope.event_id, deadlineAtMs);
            }
            this.turnEvents.publish(
              member.layout.memberId,
              event.threadId,
              envelope,
            );
            if (event.method === "turn/completed") {
              this.turnEvents.complete(member.layout.memberId, event.threadId);
            }
            return;
          }
          if (input.eventScope.type === "room_side_chat") {
            if (!event.threadId) return;
            const envelope = homeCodexRuntimeEvent(
              member.layout.memberId,
              event.threadId,
              event,
            );
            this.turnEvents.publish(
              member.layout.memberId,
              input.eventScope.eventKey,
              envelope,
            );
            return;
          }
          const resolvedRequestId = asRecord(event.payload)?.requestId;
          const resolvedRequestKey = event.method === "serverRequest/resolved"
            && (typeof resolvedRequestId === "string" || typeof resolvedRequestId === "number")
            ? roomRequestKey(input.eventScope.executionId, resolvedRequestId)
            : null;
          const resolvedInteractionId = resolvedRequestKey
            ? this.resolvedRoomInteractionIds.get(resolvedRequestKey) ?? null
            : null;
          const envelope = resolvedInteractionId
            ? roomResolvedInteractionEvent(
              member.layout.memberId,
              input.eventScope.roomId,
              input.eventScope.executionId,
              event,
              resolvedInteractionId,
            )
            : roomCodexRuntimeEvent(
              member.layout.memberId,
              input.eventScope.roomId,
              input.eventScope.executionId,
              event,
            );
          if (resolvedRequestKey && resolvedInteractionId) {
            this.resolvedRoomInteractionIds.delete(resolvedRequestKey);
          }
          const binding = envelope.type === "agent_runtime.interaction_request"
            ? this.beginInteractionBinding(
              member.layout.memberId,
              input.eventScope.roomId,
              input.eventScope.executionId,
            )
            : null;
          try {
            const accepted = await this.publishAgentRoomActivity(envelope);
            if (envelope.type !== "agent_runtime.interaction_request") {
              if (accepted.interaction_id !== null) {
                throw new MemberRuntimeError(
                  "agent_activity_interaction_mismatch",
                  "Backend returned an interaction id for a non-interactive Runtime event.",
                );
              }
              return;
            }
            if (!event.respond || accepted.interaction_id === null) {
              throw new MemberRuntimeError(
                "agent_activity_interaction_missing",
                "Backend did not bind the in-flight Codex interaction request.",
                { retryable: true },
              );
            }
            const interactionId = accepted.interaction_id;
            const existing = this.pendingInteractions.get(interactionId);
            if (
              existing
              && (
                existing.eventId !== envelope.event_id
                || existing.executionId !== input.eventScope.executionId
              )
            ) {
              throw new MemberRuntimeError(
                "agent_activity_interaction_conflict",
                "Backend reused an interaction id for a different in-flight request.",
              );
            }
            this.pendingInteractions.set(interactionId, {
              interactionId,
              eventId: envelope.event_id,
              executionId: input.eventScope.executionId,
              roomId: input.eventScope.roomId,
              memberId: member.layout.memberId,
              method: envelope.method,
              requestId: envelope.request_id,
              payload: envelope.payload,
              respond: event.respond,
              state: "pending",
            });
            roomInteractionIds.add(interactionId);
          } finally {
            if (binding) this.endInteractionBinding(binding);
          }
        },
        onChatgptAuthTokensRefresh: async (_refresh) => {
          const tokens = await this.refreshExecutorTokens(member);
          if (tokens.credential.type !== "chatgpt_auth_tokens") {
            throw new MemberRuntimeError(
              "executor_auth_method_mismatch",
              "Custom API Executors do not provide ChatGPT refresh tokens.",
            );
          }
          return {
            accessToken: tokens.credential.access_token,
            chatgptAccountId: tokens.credential.account_id,
            chatgptPlanType: tokens.credential.plan_type,
          };
        },
      });
      return await started.completed;
    } finally {
      for (const interactionId of roomInteractionIds) {
        this.pendingInteractions.delete(interactionId);
      }
    }
  }

  private async publishAgentRoomActivity(
    event: RoomCodexAgentRuntimeEnvelope,
  ): Promise<RoomCodexAgentRuntimeActivityAccepted> {
    const publish = this.options.publishAgentRoomActivity;
    if (!publish) {
      throw new MemberRuntimeError(
        "agent_activity_callback_unavailable",
        "Company Runtime has no Backend Agent activity callback.",
        { retryable: true },
      );
    }
    let attempt = 0;
    while (!this.closing) {
      try {
        const accepted = await publish(event);
        if (accepted.event_id !== event.event_id) {
          throw new MemberRuntimeError(
            "agent_activity_ack_mismatch",
            "Backend acknowledged a different Agent activity event.",
          );
        }
        return accepted;
      } catch (error) {
        if (
          error instanceof MemberRuntimeError
          && error.code === "agent_activity_ack_mismatch"
        ) {
          throw error;
        }
        const delay = this.activityRetryDelaysMs[
          Math.min(attempt, this.activityRetryDelaysMs.length - 1)
        ]!;
        attempt += 1;
        await this.waitForActivityRetry(delay);
      }
    }
    throw new MemberRuntimeError(
      "company_runtime_closing",
      "Company Runtime stopped retrying the Agent activity callback.",
      { retryable: true },
    );
  }

  private async publishHomeTerminalNotification(
    event: Omit<HomeTerminalNotificationInput, "identity">,
  ): Promise<void> {
    const publish = this.options.publishHomeTerminalNotification;
    if (!publish) return;
    for (let attempt = 0; attempt < 3 && !this.closing; attempt += 1) {
      try {
        await publish(event);
        emitLifecycleEvent("codex.home.terminal_notification", {
          result: "succeeded",
          retryable: false,
          "fields.actor_id": event.recipient_actor_id,
          "fields.thread_id": event.thread_id,
          status: event.status,
          attempt: attempt + 1,
        });
        return;
      } catch {
        const exhausted = attempt === 2;
        emitLifecycleEvent("codex.home.terminal_notification", {
          result: "failed",
          retryable: !exhausted,
          code: "backend_notification_callback_failed",
          "fields.actor_id": event.recipient_actor_id,
          "fields.thread_id": event.thread_id,
          status: event.status,
          attempt: attempt + 1,
        });
        if (!exhausted) {
          await this.waitForActivityRetry(this.activityRetryDelaysMs[attempt] ?? 1_000);
        }
      }
    }
  }

  private waitForActivityRetry(delayMs: number): Promise<void> {
    if (this.closing) return Promise.resolve();
    return new Promise((resolvePromise) => {
      const waiter = {
        handle: setTimeout(() => {
          this.activityRetryWaiters.delete(waiter);
          resolvePromise();
        }, delayMs),
        resolve: resolvePromise,
      };
      this.activityRetryWaiters.add(waiter);
    });
  }

  private rememberInteractionResponse(
    idempotencyKey: string,
    response: CachedInteractionResponse,
  ): void {
    this.interactionResponses.set(idempotencyKey, response);
    while (this.interactionResponses.size > INTERACTION_RESPONSE_CACHE_LIMIT) {
      const oldest = this.interactionResponses.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.interactionResponses.delete(oldest);
    }
  }

  private beginInteractionBinding(
    memberId: string,
    roomId: string,
    executionId: string,
  ): InteractionBindingFlight {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const flight = {
      memberId,
      roomId,
      executionId,
      promise,
      resolve: resolvePromise,
    };
    const flights = this.interactionBindingFlights.get(executionId) ?? new Set();
    flights.add(flight);
    this.interactionBindingFlights.set(executionId, flights);
    return flight;
  }

  private endInteractionBinding(flight: InteractionBindingFlight): void {
    flight.resolve();
    const flights = this.interactionBindingFlights.get(flight.executionId);
    flights?.delete(flight);
    if (flights?.size === 0) {
      this.interactionBindingFlights.delete(flight.executionId);
    }
  }

  private async waitForInteractionBinding(
    dispatch: AgentRoomInteractionResponseDispatch,
  ): Promise<void> {
    const flights = [...(this.interactionBindingFlights.get(dispatch.execution_id) ?? [])]
      .filter((flight) => (
        flight.memberId === dispatch.agent_member_id
        && flight.roomId === dispatch.room_id
      ));
    if (flights.length > 0) {
      await Promise.allSettled(flights.map((flight) => flight.promise));
    }
  }

  private async refreshExecutorTokens(member: ManagedMember): Promise<RuntimeExecutorTokens> {
    const existing = this.refreshFlights.get(member.executorId);
    if (existing) return existing;
    const flight = this.issueExecutorTokens({
      executorId: member.executorId,
      credentialVersion: member.credentialVersion,
    }, "app_server_refresh").then((tokens) => {
      for (const candidate of this.members.values()) {
        if (candidate.executorId === tokens.executor_id) {
          candidate.credentialVersion = tokens.credential_version;
          candidate.chatgptAccountId = tokens.credential.type === "chatgpt_auth_tokens"
            ? tokens.credential.account_id
            : null;
        }
      }
      return tokens;
    }).finally(() => {
      if (this.refreshFlights.get(member.executorId) === flight) {
        this.refreshFlights.delete(member.executorId);
      }
    });
    this.refreshFlights.set(member.executorId, flight);
    return flight;
  }

  private async issueExecutorTokens(
    executor: RuntimeExecutorTarget,
    reason: CompanyExecutorTokenIssueInput["reason"],
  ): Promise<RuntimeExecutorTokens> {
    const issued = await this.options.issueTokens({
      executorId: executor.executorId,
      previousCredentialVersion: executor.credentialVersion,
      reason,
    });
    if (issued.executor_id !== executor.executorId) {
      throw new MemberRuntimeError(
        "executor_identity_changed",
        "Credential authority issued tokens for a different Executor.",
        { details: { expected_executor_id: executor.executorId, actual_executor_id: issued.executor_id } },
      );
    }
    if (
      executor.credentialVersion !== undefined
      && issued.credential_version < executor.credentialVersion
    ) {
      throw new MemberRuntimeError("executor_credential_stale", "Credential authority returned an older credential version.");
    }
    return issued;
  }

  private async stopManagedMember(member: ManagedMember): Promise<void> {
    this.revokeMailMcpToken(member.layout.memberId);
    if (member.state === "stopped" || member.socketPath === null || member.pid === null) {
      member.state = "stopped";
      member.switching = false;
      member.plugin = null;
      return;
    }
    const stopped = await (this.options.stopProcess ?? stopCodexAppServerProcess)(member.layout.workspace, {
      expectedPid: member.pid,
      requireOwned: true,
    });
    if (stopped.terminated !== true) {
      throw new MemberRuntimeError("member_app_server_stop_failed", "Member App Server did not confirm termination.");
    }
    member.socketPath = null;
    member.pid = null;
    member.state = "stopped";
    member.switching = false;
    member.plugin = null;
  }

  private issueMailMcpToken(memberId: string): string {
    this.revokeMailMcpToken(memberId);
    const token = `mail_mcp_${randomBytes(32).toString("base64url")}`;
    this.mailMcpTokenByMember.set(memberId, token);
    this.mailMcpMemberByToken.set(token, memberId);
    return token;
  }

  private revokeMailMcpToken(memberId: string): void {
    const token = this.mailMcpTokenByMember.get(memberId);
    if (token) this.mailMcpMemberByToken.delete(token);
    this.mailMcpTokenByMember.delete(memberId);
  }

  private async ensureKnownMember(
    memberId: string,
    options: { allowSwitching?: boolean; allowTerminal?: boolean } = {},
  ): Promise<ManagedMember> {
    const known = this.members.get(memberId);
    if (!known) {
      throw new MemberRuntimeError(
        "member_app_server_not_started",
        "Backend must start the Member App Server with its current Executor before using Member data-plane APIs.",
        { retryable: true, details: { member_id: memberId } },
      );
    }
    return this.ensureMember(memberId, {
      executorId: known.executorId,
      credentialVersion: known.credentialVersion,
      memoryEnabled: known.memoryEnabled,
      memoryManaged: known.memoryManaged,
      memoryModel: known.memoryModel ?? undefined,
    }, options);
  }

  private async hydratePersistedExecutions(memberId: string): Promise<void> {
    if (this.hydratedMembers.has(memberId)) return;
    const layout = await provisionMemberWorkspace(this.workdir, memberId);
    const state = await readMemberRuntimeState(layout);
    this.homeProjectsByMember.set(memberId, new Map(
      state.projects.map((project) => [project.projectId, project]),
    ));
    for (const execution of state.executions) {
      this.executionResults.set(execution.idempotencyKey, execution);
    }
    for (const completion of state.pendingCompletions) {
      this.pendingExecutionCompletions.set(completion.idempotency_key, {
        memberId,
        completion,
      });
    }
    for (const receipt of state.homeMutationReceipts) {
      this.homeMutationReceipts.set(
        `${receipt.memberId}\0${receipt.idempotencyKey}`,
        receipt,
      );
    }
    for (const question of state.homeQuestions) {
      this.homeQuestionHistory.set(question.interaction.id, question);
    }
    this.hydratedMembers.add(memberId);
  }

  private persistMemberState(member: ManagedMember): Promise<void> {
    const memberId = member.layout.memberId;
    const previous = this.stateWriteChains.get(memberId) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(() => writeMemberRuntimeState(member.layout, {
      projects: [...(this.homeProjectsByMember.get(memberId)?.values() ?? [])],
      threads: [...member.threads.values()].map((thread) => ({
        ...thread,
        workspaceRoots: [...thread.workspaceRoots],
      })),
      executions: [...this.executionResults.values()]
        .filter((execution) => execution.memberId === memberId)
        .slice(-1_000),
      pendingCompletions: [...this.pendingExecutionCompletions.values()]
        .filter((pending) => pending.memberId === memberId)
        .map((pending) => pending.completion),
      homeMutationReceipts: [...this.homeMutationReceipts.values()]
        .filter((receipt) => receipt.memberId === memberId)
        .slice(-1_000),
      homeQuestions: [...this.homeQuestionHistory.values()]
        .filter((question) => question.memberId === memberId && question.interaction.status === "completed")
        .slice(-1_000),
    })).finally(() => {
      if (this.stateWriteChains.get(memberId) === write) {
        this.stateWriteChains.delete(memberId);
      }
    });
    this.stateWriteChains.set(memberId, write);
    return write;
  }

  private async persistMemberStateById(memberId: string): Promise<void> {
    if (await this.isMemberTerminalPersisted(memberId)) return;
    const member = this.members.get(memberId);
    if (member) {
      await this.persistMemberState(member);
      return;
    }
    const layout = await provisionMemberWorkspace(this.workdir, memberId);
    const state = await readMemberRuntimeState(layout);
    const previous = this.stateWriteChains.get(memberId) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(() => writeMemberRuntimeState(layout, {
      projects: state.projects,
      threads: state.threads,
      executions: [...this.executionResults.values()]
        .filter((execution) => execution.memberId === memberId)
        .slice(-1_000),
      pendingCompletions: [...this.pendingExecutionCompletions.values()]
        .filter((pending) => pending.memberId === memberId)
        .map((pending) => pending.completion),
      homeMutationReceipts: [...this.homeMutationReceipts.values()]
        .filter((receipt) => receipt.memberId === memberId)
        .slice(-1_000),
      homeQuestions: [...this.homeQuestionHistory.values()]
        .filter((question) => question.memberId === memberId && question.interaction.status === "completed")
        .slice(-1_000),
    })).finally(() => {
      if (this.stateWriteChains.get(memberId) === write) {
        this.stateWriteChains.delete(memberId);
      }
    });
    this.stateWriteChains.set(memberId, write);
    await write;
  }

  private withHomeMutationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.homeMutationChains.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined).finally(() => {
      if (this.homeMutationChains.get(key) === tail) {
        this.homeMutationChains.delete(key);
      }
    });
    this.homeMutationChains.set(key, tail);
    return result;
  }

  private readHomeMutationReceipt<T>(
    memberId: string,
    idempotencyKey: string,
    fingerprint: string,
    type: HomeMutationReceipt["result"]["type"],
  ): T | null {
    const receipt = this.homeMutationReceipts.get(`${memberId}\0${idempotencyKey}`);
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint || receipt.result.type !== type) {
      throw new MemberRuntimeError("home_mutation_idempotency_conflict", "Home mutation idempotency key was reused.");
    }
    const { type: _type, ...result } = receipt.result;
    return result as T;
  }

  private writeHomeMutationReceipt(
    memberId: string,
    idempotencyKey: string,
    fingerprint: string,
    result: HomeMutationReceipt["result"],
  ): void {
    this.homeMutationReceipts.set(`${memberId}\0${idempotencyKey}`, {
      memberId,
      idempotencyKey,
      fingerprint,
      result,
    });
  }

  private nowMs(): number {
    return this.options.nowMs?.() ?? Date.now();
  }

  private assertMemberNotTerminal(memberId: string): void {
    if (
      this.cleanupRequestedMembers.has(memberId)
      || this.cleaningMembers.has(memberId)
      || this.terminalMembers.has(memberId)
    ) {
      throw new MemberRuntimeError(
        "member_terminal",
        "Member cleanup is terminal; Runtime work for this Member is no longer accepted.",
        { details: { member_id: memberId } },
      );
    }
  }

  private async assertMemberNotTerminalPersisted(memberId: string): Promise<void> {
    memberWorkspaceLayout(this.workdir, memberId);
    this.assertMemberNotTerminal(memberId);
    const marker = await readMemberTerminalMarker(this.workdir, memberId);
    if (marker) this.terminalMembers.add(memberId);
    this.assertMemberNotTerminal(memberId);
  }

  private async isMemberTerminalPersisted(memberId: string): Promise<boolean> {
    memberWorkspaceLayout(this.workdir, memberId);
    if (this.cleaningMembers.has(memberId) || this.terminalMembers.has(memberId)) return true;
    const marker = await readMemberTerminalMarker(this.workdir, memberId);
    if (marker) this.terminalMembers.add(memberId);
    return marker !== null;
  }

  private trackMemberDispatchAdmission(memberId: string, admission: Promise<void>): void {
    const admissions = this.memberDispatchAdmissions.get(memberId) ?? new Set();
    admissions.add(admission);
    this.memberDispatchAdmissions.set(memberId, admissions);
    void admission.finally(() => {
      admissions.delete(admission);
      if (admissions.size === 0 && this.memberDispatchAdmissions.get(memberId) === admissions) {
        this.memberDispatchAdmissions.delete(memberId);
      }
    }).catch(() => undefined);
  }

  private assertCleanupOperationMember(
    operationId: string,
    existingMemberId: string,
    requestedMemberId: string,
  ): void {
    if (existingMemberId !== requestedMemberId) {
      throw new MemberRuntimeError(
        "member_cleanup_operation_conflict",
        "Member cleanup operation id was already used for a different Member.",
        {
          details: {
            operation_id: operationId,
            existing_member_id: existingMemberId,
            requested_member_id: requestedMemberId,
          },
        },
      );
    }
  }

  private assertOpen(): void {
    if (this.closing) {
      throw new MemberRuntimeError("company_runtime_closing", "Company Runtime is shutting down.", { retryable: true });
    }
  }
}

async function loginMember(socketPath: string, tokens: RuntimeExecutorTokens): Promise<void> {
  if (tokens.credential.type !== "chatgpt_auth_tokens") return;
  await loginWithChatgptAuthTokens(socketPath, {
    accessToken: tokens.credential.access_token,
    chatgptAccountId: tokens.credential.account_id,
    chatgptPlanType: tokens.credential.plan_type,
  });
}

function memberRecord(member: ManagedMember): MemberAppServerRecord {
  return {
    memberId: member.layout.memberId,
    executorId: member.executorId,
    credentialVersion: member.credentialVersion,
    chatgptAccountId: member.chatgptAccountId,
    workspace: member.layout.workspace,
    codexHome: member.layout.codexHome,
    socketPath: member.socketPath,
    pid: member.pid,
    state: member.state,
    lastActivityAtMs: member.lastActivityAtMs,
    activeExecutionCount: member.activeExecutions.size,
    threads: [...member.threads.values()].map((thread) => ({
      ...thread,
      workspaceRoots: [...thread.workspaceRoots],
    })),
    plugin: member.plugin,
  };
}

function runtimeErrorCode(error: unknown, fallback = "member_executor_switch_failed"): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return fallback;
}

function runtimeErrorRetryable(error: unknown): boolean {
  return error instanceof MemberRuntimeError ? error.retryable : true;
}

async function activationStep<T>(
  stage: string,
  code: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MemberRuntimeError) {
      if (activationErrorStage(error)) throw error;
      throw new MemberRuntimeError(error.code, error.message, {
        retryable: error.retryable,
        details: { ...error.details, activation_stage: stage },
      });
    }
    throw new MemberRuntimeError(
      runtimeErrorCode(error, code),
      error instanceof Error ? error.message : "Member App Server activation failed.",
      {
        retryable: true,
        details: { activation_stage: stage },
      },
    );
  }
}

function activationErrorStage(error: unknown): string | null {
  if (!(error instanceof MemberRuntimeError)) return null;
  const stage = error.details.activation_stage;
  return typeof stage === "string" && stage.length > 0 ? stage : null;
}

function activationFailureCode(stage: string): string {
  switch (stage) {
    case "workspace":
      return "member_workspace_activation_failed";
    case "resume":
      return "member_thread_resume_failed";
    default:
      return "member_app_server_activation_failed";
  }
}

function activationCleanupError(
  activationError: unknown,
  stopError: unknown,
): MemberRuntimeError {
  return new MemberRuntimeError(
    "member_app_server_activation_cleanup_failed",
    "Member App Server activation failed and its process could not be stopped.",
    {
      retryable: true,
      details: {
        activation_error: runtimeErrorCode(activationError),
        stop_error: runtimeErrorCode(stopError),
      },
    },
  );
}

function isUnauthorizedTurnCompletion(event: CodexAppServerRawEvent): boolean {
  if (event.method !== "turn/completed") return false;
  const params = recordValue(event.payload);
  const turn = recordValue(params?.turn);
  const error = recordValue(turn?.error);
  return error?.codexErrorInfo === "unauthorized";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cloneExecutionCompletion(
  completion: AgentRoomExecutionCompletion,
): AgentRoomExecutionCompletion {
  return {
    ...completion,
    error: completion.error ? { ...completion.error } : null,
  };
}

function roomMessagesThreadConfig(): Record<string, JsonValue> {
  return {
    plugins: {
      "fields-core@fields": {
        mcp_servers: {
          fields_room_messages: {
            enabled: true,
          },
        },
      },
    },
  };
}

function requireSocket(member: ManagedMember): string {
  if (!member.socketPath) {
    throw new MemberRuntimeError("member_app_server_stopped", "Member App Server is not running.", { retryable: true });
  }
  return member.socketPath;
}

function roomMappedThreadIds(member: ManagedMember): Set<string> {
  return new Set(
    [...member.threads.values()].flatMap((thread) => (
      thread.roomId === null ? [] : [thread.threadId]
    )),
  );
}

function builderScopeKey(memberId: string, threadId: string): string {
  return `${memberId}\0${threadId}`;
}

function homeThreadListData(
  result: CodexAppServerThreadListResult,
  excludedThreadIds: ReadonlySet<string>,
): HomeThreadListResult {
  return {
    items: result.threads
      .filter((value) => {
        const threadId = stringOrNull(asRecord(value)?.id);
        return threadId === null || !excludedThreadIds.has(threadId);
      })
      .map(projectHomeThreadSummary),
    page: {
      next_cursor: result.nextCursor,
      backwards_cursor: result.backwardsCursor,
    },
  };
}

function homeThreadSearchData(
  result: CodexAppServerThreadSearchResult,
  workspace: string,
  excludedThreadIds: ReadonlySet<string>,
): HomeThreadSearchResult {
  return {
    items: result.results
      .filter((value) => {
        const record = asRecord(value);
        const thread = asRecord(record?.thread);
        const threadId = stringOrNull(thread?.id);
        return (
          thread?.cwd === workspace
          && (threadId === null || !excludedThreadIds.has(threadId))
        );
      })
      .map((value) => projectHomeThreadSummary(asRecord(value)?.thread)),
    page: {
      next_cursor: result.nextCursor,
      backwards_cursor: result.backwardsCursor,
    },
  };
}

function withCompanyFilesCache(layout: MemberWorkspaceLayout, roots: readonly string[]): string[] {
  return [...new Set([...roots, memberCompanyFilesCacheRoot(layout)])];
}

function withCompanyFileAttachmentContext(
  prompt: string,
  inputs: readonly AgentRoomCompanyFileInput[],
  root: string,
): string {
  const attachments = inputs.flatMap((input) => input.message_ids.map((messageId) => (
    `- Message ${messageId} attached ${input.name}: ${join(
      root,
      safeExecutionPathComponent(input.file_id),
      safeExecutionFileName(input.name),
    )}`
  )));
  return attachments.length === 0
    ? prompt
    : `${prompt}\n\nAttached files referenced in this conversation:\n${attachments.join("\n")}`;
}

function ensureHomeBranch(
  member: ManagedMember,
  threadId: string,
  nowMs: number,
): NonNullable<MemberThreadRecord["homeBranch"]> {
  const key = `home:${threadId}`;
  const existing = member.threads.get(key);
  if (existing?.roomId !== null && existing !== undefined) {
    throw new MemberRuntimeError("home_thread_room_mapped", "Room Threads are unavailable from Home.");
  }
  if (existing?.homeBranch) return existing.homeBranch;
  const homeBranch: NonNullable<MemberThreadRecord["homeBranch"]> = {
    rootThreadId: threadId,
    sourceThreadId: null,
    anchorTurnId: null,
    kind: "root",
    selectedThreadId: threadId,
    revision: 1,
    createdAtMs: nowMs,
  };
  member.threads.set(key, {
    key,
    roomId: null,
    threadId,
    workspaceRoots: [member.layout.workspace],
    homeBranch,
  });
  return homeBranch;
}

function homeBranches(member: ManagedMember, rootThreadId: string): Array<{
  threadId: string;
  homeBranch: NonNullable<MemberThreadRecord["homeBranch"]>;
}> {
  return [...member.threads.values()].flatMap((thread) => (
    thread.roomId === null
    && thread.homeBranch?.rootThreadId === rootThreadId
      ? [{ threadId: thread.threadId, homeBranch: thread.homeBranch }]
      : []
  )).sort((left, right) => (
    (left.homeBranch.createdAtMs ?? 0) - (right.homeBranch.createdAtMs ?? 0)
  ));
}

function updateHomeBranchSelection(
  member: ManagedMember,
  rootThreadId: string,
  selectedThreadId: string,
  revision: number,
): void {
  for (const [key, thread] of member.threads) {
    if (thread.homeBranch?.rootThreadId !== rootThreadId) continue;
    member.threads.set(key, {
      ...thread,
      homeBranch: {
        ...thread.homeBranch,
        selectedThreadId,
        revision,
      },
    });
  }
}

function homeTurns(value: unknown): Record<string, unknown>[] {
  const thread = asRecord(value);
  return Array.isArray(thread?.turns)
    ? thread.turns.flatMap((turn) => {
      const record = asRecord(turn);
      return record ? [record] : [];
    })
    : [];
}

function assertHomeTurnExists(value: unknown, turnId: string): void {
  if (!homeTurns(value).some((turn) => turn.id === turnId)) {
    throw new MemberRuntimeError("home_turn_not_found", "The selected Home Turn does not exist.");
  }
}

function homeTurnPrompt(value: unknown, turnId: string): string | null {
  const turn = homeTurns(value).find((candidate) => candidate.id === turnId);
  if (!turn || !Array.isArray(turn.items)) return null;
  for (const itemValue of turn.items) {
    const item = asRecord(itemValue);
    if (item?.type !== "userMessage" || !Array.isArray(item.content)) continue;
    const text = item.content.flatMap((partValue) => {
      const part = asRecord(partValue);
      return part?.type === "text" && typeof part.text === "string" ? [part.text] : [];
    }).join("\n").trim();
    if (text.length > 0) return text;
  }
  return null;
}

function homeThreadReadData(
  requestedThreadId: string,
  results: Array<{ threadId: string; result: CodexAppServerThreadReadResult }>,
  branches: ReturnType<typeof homeBranches>,
  workspace?: string,
): HomeThreadReadResult {
  const selectedResult = results.find((candidate) => candidate.threadId === requestedThreadId)
    ?? results[0];
  const thread = asRecord(selectedResult?.result.thread) ?? {};
  const threadId = stringOrNull(thread.id)
    ?? selectedResult?.result.threadId
    ?? requestedThreadId;
  const selected = branches.find((branch) => branch.homeBranch.selectedThreadId === threadId)
    ?? branches[0];
  const rootThreadId = selected?.homeBranch.rootThreadId ?? threadId;
  const revision = selected?.homeBranch.revision ?? 1;
  return {
    thread_id: threadId,
    root_thread_id: rootThreadId,
    selected_thread_id: selected?.homeBranch.selectedThreadId ?? threadId,
    revision,
    branches: branches.map((branch) => ({
      thread_id: branch.threadId,
      root_thread_id: branch.homeBranch.rootThreadId,
      source_thread_id: branch.homeBranch.sourceThreadId,
      anchor_turn_id: branch.homeBranch.anchorTurnId,
      kind: branch.homeBranch.kind,
      selected: branch.threadId === branch.homeBranch.selectedThreadId,
      created_at_ms: branch.homeBranch.createdAtMs,
    })),
    turns: results.flatMap((candidate) => {
      const candidateThread = asRecord(candidate.result.thread) ?? {};
      const candidateThreadId = stringOrNull(candidateThread.id)
        ?? candidate.result.threadId
        ?? candidate.threadId;
      const turns = Array.isArray(candidateThread.turns) ? candidateThread.turns : [];
      return turns.flatMap((turn) => {
        const snapshot = homeTurnSnapshot(turn, workspace);
        return snapshot.turn_id
          ? [{ thread_id: candidateThreadId, turn_id: snapshot.turn_id, origin: "native" as const, snapshot }]
          : [];
      });
    }),
  };
}

function homeTurnSnapshot(value: unknown, workspace?: string): AgentTurnSnapshot {
  const turn = asRecord(value) ?? {};
  const items = Array.isArray(turn.items)
    ? turn.items.flatMap((item) => {
      const projected = homeTurnItem(item, workspace);
      return projected ? [projected] : [];
    })
    : [];
  const startedAtMs = secondsToMs(numberOrNull(turn.startedAt));
  const completedAtMs = secondsToMs(numberOrNull(turn.completedAt));
  const status = homeTurnStatus(turn.status);
  return {
    turn_id: stringOrNull(turn.id),
    status,
    started_at_ms: startedAtMs,
    completed_at_ms: completedAtMs,
    duration_ms: nonnegativeIntegerValue(turn.durationMs)
      ?? (
        startedAtMs !== null && completedAtMs !== null
          ? Math.max(0, completedAtMs - startedAtMs)
          : null
      ),
    error: status === "failed"
      ? { code: "AGENT_TURN_FAILED", message: "Agent turn failed." }
      : null,
    narrative_items: items.filter(isHomeNarrativeItem),
    activity_items: items.filter(isHomeActivityItem),
    interactions: [],
  };
}

function questionInteractionFromPayload(
  interactionId: string,
  itemId: string | null,
  value: unknown,
  createdAtMs: number,
  deadlineAtMs: number | null,
): AgentQuestionInteraction {
  const payload = asRecord(value);
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  const projected = questions.flatMap((entry) => {
    const question = asRecord(entry);
    const id = stringOrNull(question?.id);
    const prompt = stringOrNull(question?.question);
    if (!id || !prompt) return [];
    const options = question?.options === null
      ? null
      : Array.isArray(question?.options)
        ? question.options.flatMap((optionValue) => {
          const option = asRecord(optionValue);
          const label = stringOrNull(option?.label);
          return label ? [{ label, description: stringOrNull(option?.description) ?? "" }] : [];
        })
        : null;
    return [{
      id,
      header: stringOrNull(question?.header) ?? "",
      question: prompt,
      allow_other: question?.isOther === true,
      secret: question?.isSecret === true,
      options,
    }];
  });
  if (projected.length === 0) {
    throw new MemberRuntimeError("question_interaction_invalid", "Codex question request did not contain a valid question.");
  }
  return {
    id: interactionId,
    item_id: itemId ?? interactionId,
    status: "pending",
    questions: projected,
    answers: {},
    resolution: null,
    deadline_at_ms: deadlineAtMs,
    created_at_ms: createdAtMs,
    completed_at_ms: null,
  };
}

function validateQuestionAnswers(
  interaction: AgentQuestionInteraction,
  answers: Record<string, string[]>,
): void {
  const questionIds = new Set(interaction.questions.map((question) => question.id));
  if (Object.keys(answers).some((id) => !questionIds.has(id))) {
    throw new MemberRuntimeError("interaction_response_invalid", "Question answer ids did not match the request.");
  }
}

function completeQuestionInteraction(
  interaction: AgentQuestionInteraction,
  answers: Record<string, string[]>,
  resolution: "answered" | "dismissed" | "timed_out",
  completedAtMs: number,
): AgentQuestionInteraction {
  const secretIds = new Set(interaction.questions.filter((question) => question.secret).map((question) => question.id));
  return {
    ...interaction,
    status: "completed",
    answers: Object.fromEntries(Object.entries(answers).map(([id, values]) => [id, {
      values: secretIds.has(id) && values.length > 0 ? ["••••••"] : values,
      redacted: secretIds.has(id),
    }])),
    resolution,
    deadline_at_ms: null,
    completed_at_ms: completedAtMs,
  };
}

function homeTurnItem(value: unknown, workspace?: string): AgentNarrativeItem | AgentActivityItem | null {
  const item = asRecord(value);
  const id = stringOrNull(item?.id);
  const type = stringOrNull(item?.type);
  if (!item || !id || !type) return null;
  const status = homeTurnStatus(item.status);
  if (type === "userMessage") {
    const content = Array.isArray(item.content)
      ? item.content.flatMap((content) => homeUserContent(content, workspace))
      : [];
    return { id, type: "user_message", status: "completed", content };
  }
  if (type === "agentMessage") {
    return {
      id,
      type: "assistant_message",
      status,
      phase: item.phase === "commentary" || item.phase === "final_answer"
        ? item.phase
        : "unknown",
      content: [{ type: "markdown", markdown: safePublicText(item.text) }],
    };
  }
  if (type === "plan") {
    return {
      id,
      type: "plan",
      status,
      content: [{ type: "markdown", markdown: safePublicText(item.text) }],
    };
  }
  if (type === "reasoning") {
    return {
      id,
      type: "reasoning",
      status,
      summary: stringArrayValue(item.summary).map((markdown) => ({ type: "markdown", markdown })),
      content: stringArrayValue(item.content).map((markdown) => ({ type: "markdown", markdown })),
    };
  }
  if (type === "commandExecution") {
    return {
      id,
      type: "command",
      status,
      command: safePublicText(item.command),
      cwd: nullableSafePublicText(item.cwd),
      actions: [],
      output: nullableSafePublicText(item.aggregatedOutput),
      exit_code: integerValue(item.exitCode),
      duration_ms: nonnegativeIntegerValue(item.durationMs),
    };
  }
  if (type === "fileChange") {
    return {
      id,
      type: "file_change",
      status,
      changes: Array.isArray(item.changes)
        ? item.changes.flatMap((entry) => {
          const change = asRecord(entry);
          const path = stringOrNull(change?.path);
          if (!path) return [];
          const rawKind = asRecord(change?.kind)?.type ?? change?.kind;
          return [{
            path: safePublicText(path),
            kind: rawKind === "add" || rawKind === "delete" ? rawKind : "update",
            diff: safePublicText(change?.diff),
          }];
        })
        : [],
    };
  }
  if (type === "webSearch") {
    const action = asRecord(item.action);
    const uri = nullableSafePublicText(action?.url);
    const query = safePublicText(item.query);
    return {
      id,
      type: "web_search",
      status,
      query,
      detail: uri ?? (query || "Web search"),
      uri,
    };
  }
  if (type === "collabAgentToolCall") {
    if (item.tool === "wait") return null;
    const targetIds = stringArrayValue(item.receiverThreadIds);
    return {
      id,
      type: "collaboration",
      status,
      action: item.tool === "spawn_agent"
        ? "spawn"
        : item.tool === "resume_agent"
          ? "resume"
          : item.tool === "close_agent"
            ? "close"
            : "send_input",
      target_count: targetIds.length,
      target_ids: targetIds,
      prompt: nullableSafePublicText(item.prompt),
    };
  }
  if (type === "subAgentActivity") {
    const activity = item.kind === "interrupted"
      ? "interrupted"
      : item.kind === "started"
        ? "started"
        : "interacted";
    return {
      id,
      type: "subagent_activity",
      status,
      activity,
      agent_turn_id: safePublicText(item.agentThreadId) || id,
      agent_label: nullableSafePublicText(item.agentPath),
    };
  }
  if (type === "imageView") {
    const path = nullableSafePublicText(item.path);
    return path
      ? {
        id,
        type: "image_view",
        status,
        images: [{ type: "image", uri: path, alt_text: null, mime_type: null }],
      }
      : null;
  }
  if (type === "imageGeneration") {
    const path = nullableSafePublicText(item.savedPath);
    return {
      id,
      type: "image_generation",
      status,
      content: path ? [{ type: "image", uri: path, alt_text: null, mime_type: null }] : [],
      revised_prompt: nullableSafePublicText(item.revisedPrompt),
    };
  }
  if (type === "contextCompaction") {
    return { id, type: "context_compaction", status };
  }
  if (
    type === "hookPrompt"
    || type === "sleep"
    || type === "enteredReviewMode"
    || type === "exitedReviewMode"
  ) {
    return null;
  }
  const namespace = type === "mcpToolCall"
    ? nullableSafePublicText(item.server)
    : nullableSafePublicText(item.namespace);
  const name = safePublicText(item.tool) || type;
  return {
    id,
    type: "tool_call",
    status,
    namespace,
    name,
    display_name: nullableSafePublicText(asRecord(item.appContext)?.actionName),
    content: homeToolContent(item),
    progress: stringArrayValue(item.progress),
    error: item.error ? { code: "AGENT_TOOL_CALL_FAILED", message: "Tool call failed." } : null,
    duration_ms: nonnegativeIntegerValue(item.durationMs),
  };
}

function homeUserContent(value: unknown, workspace?: string): AgentContent[] {
  const part = asRecord(value);
  if (!part) return [];
  if (part.type === "text") {
    const text = safePublicText(part.text);
    return text ? [{ type: "markdown", markdown: text }] : [];
  }
  if (part.type === "image") {
    const uri = nullableSafePublicText(part.url);
    return uri ? [{ type: "image", uri, alt_text: null, mime_type: null }] : [];
  }
  if (part.type === "localImage" && workspace && typeof part.path === "string") {
    const uri = homeImageRenderUri(workspace, part.path);
    if (uri) return [{
      type: "image",
      uri,
      alt_text: basename(part.path),
      mime_type: imageMimeTypeFromPath(part.path),
    }];
  }
  const label = nullableSafePublicText(part.name) ?? nullableSafePublicText(part.path);
  return label ? [{ type: "text", text: label.split(/[\\/]/u).at(-1) ?? label }] : [];
}

function homeToolContent(item: Record<string, unknown>): AgentContent[] {
  const result = asRecord(item.result);
  const values = Array.isArray(result?.content)
    ? result.content
    : Array.isArray(item.contentItems)
      ? item.contentItems
      : [];
  return values.flatMap((entry): AgentContent[] => {
    if (typeof entry === "string") return [{ type: "text", text: safePublicText(entry) }];
    const content = asRecord(entry);
    if (!content) return [];
    if (content.type === "text" && typeof content.text === "string") {
      return [{ type: "text", text: safePublicText(content.text) }];
    }
    const uri = nullableSafePublicText(content.uri)
      ?? nullableSafePublicText(content.imageUrl)
      ?? nullableSafePublicText(content.audioUrl);
    if (!uri) return [];
    if (content.type === "audio") {
      return [{ type: "audio", uri, mime_type: null, transcript: null }];
    }
    if (content.type === "resource_link") {
      return [{ type: "resource_link", uri, title: nullableSafePublicText(content.title), mime_type: null }];
    }
    return [{ type: "image", uri, alt_text: null, mime_type: null }];
  });
}

function homeTurnStatus(value: unknown): AgentTurnStatus {
  const type = typeof value === "string" ? value : stringOrNull(asRecord(value)?.type);
  if (type === "completed" || type === "failed" || type === "interrupted") return type;
  if (type === "declined") return "declined";
  if (type === "inProgress" || type === "running" || type === "active") return "running";
  return "queued";
}

function isHomeNarrativeItem(
  item: AgentNarrativeItem | AgentActivityItem,
): item is AgentNarrativeItem {
  return item.type === "user_message"
    || item.type === "assistant_message"
    || item.type === "plan"
    || item.type === "reasoning";
}

function isHomeActivityItem(
  item: AgentNarrativeItem | AgentActivityItem,
): item is AgentActivityItem {
  return !isHomeNarrativeItem(item);
}

function safePublicText(value: unknown): string {
  return typeof value === "string"
    ? value
      .replace(/Bearer\\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
      .replace(/(?:sk|sess)-[A-Za-z0-9_-]{12,}/gu, "[REDACTED]")
    : "";
}

function nullableSafePublicText(value: unknown): string | null {
  const text = safePublicText(value);
  return text.length > 0 ? text : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === "string" ? [safePublicText(entry)] : [])
    : [];
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function nonnegativeIntegerValue(value: unknown): number | null {
  const integer = integerValue(value);
  return integer !== null && integer >= 0 ? integer : null;
}

function projectHomeThreadSummary(value: unknown): HomeThreadSummary {
  const thread = asRecord(value);
  const threadId = stringOrNull(thread?.id);
  if (!thread || !threadId) {
    throw new MemberRuntimeError("invalid_codex_thread", "Codex returned a Thread without an id.");
  }
  const status = asRecord(thread.status)?.type;
  return {
    thread_id: threadId,
    title: stringOrNull(thread.name),
    preview: stringOrNull(thread.preview),
    created_at_ms: secondsToMs(numberOrNull(thread.createdAt)),
    updated_at_ms: secondsToMs(numberOrNull(thread.updatedAt)),
    status: status === "idle" || status === "active"
      ? status
      : status === "systemError" ? "error" : "unknown",
    unread_count: 0,
    read_through: null,
    origin: { kind: "native" },
  };
}

function homeTerminalTitle(prompt: string): string {
  const title = safePublicText(prompt).trim().split(/\r?\n/u, 1)[0]?.trim() ?? "";
  return (title || "Image conversation").slice(0, 255);
}

function homeTerminalPreview(agentText: string): string | null {
  const preview = safePublicText(agentText).trim();
  return preview.length > 0 ? preview.slice(0, 240) : null;
}

function homeTerminalStatus(
  event: CodexAppServerRawEvent,
): HomeTerminalNotificationInput["status"] {
  const turn = asRecord(asRecord(event.payload)?.turn);
  const status = homeTurnStatus(turn?.status);
  return status === "completed" || status === "interrupted" ? status : "failed";
}

function homeTerminalErrorStatus(
  error: unknown,
): HomeTerminalNotificationInput["status"] {
  const code = error instanceof Error && "code" in error
    ? String((error as { code: unknown }).code).toLowerCase()
    : "";
  return code.includes("interrupt") || code.includes("cancel") || code.includes("abort")
    ? "interrupted"
    : "failed";
}

function overlayImportedThreadSummaries(
  result: HomeThreadListResult | HomeThreadSearchResult,
  index: ImportedConversationIndex,
): typeof result {
  const imported = new Map(index.records.map((record) => [record.threadId, record]));
  return {
    ...result,
    items: result.items.map((item) => {
      const record = imported.get(item.thread_id);
      return record ? {
        ...item,
        title: record.title ?? item.title,
        preview: record.messages.at(-1)?.text.slice(0, 240) ?? item.preview,
        created_at_ms: record.createdAtMs,
        updated_at_ms: record.updatedAtMs,
        origin: {
          kind: "imported" as const,
          display_name: record.sourceDisplayName,
          imported_at_ms: record.importedAtMs,
        },
      } : item;
    }).sort((left, right) => (right.updated_at_ms ?? right.created_at_ms ?? 0) - (left.updated_at_ms ?? left.created_at_ms ?? 0)),
  };
}

async function collectNativeThreadPages(
  readPage: (cursor: string | null) => Promise<CodexAppServerThreadListResult>,
): Promise<unknown[]> {
  const values: unknown[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page = await readPage(cursor);
    values.push(...page.threads);
    if (page.nextCursor === null) return values;
    if (cursors.has(page.nextCursor)) throw new MemberRuntimeError("home_thread_cursor_invalid", "Codex returned a repeated Home Thread cursor.");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

async function collectNativeSearchPages(
  readPage: (cursor: string | null) => Promise<CodexAppServerThreadSearchResult>,
): Promise<unknown[]> {
  const values: unknown[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page = await readPage(cursor);
    values.push(...page.results);
    if (page.nextCursor === null) return values;
    if (cursors.has(page.nextCursor)) throw new MemberRuntimeError("home_thread_cursor_invalid", "Codex returned a repeated Home Thread search cursor.");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

function paginateImportedThreadSummaries<T extends HomeThreadListResult | HomeThreadSearchResult>(
  result: T,
  cursor: string | null | undefined,
  requestedLimit: number | undefined,
): T {
  const offset = decodeImportedThreadCursor(cursor);
  const limit = requestedLimit ?? 20;
  const end = Math.min(result.items.length, offset + limit);
  return {
    ...result,
    items: result.items.slice(offset, end),
    page: {
      next_cursor: end < result.items.length ? encodeImportedThreadCursor(end) : null,
      backwards_cursor: offset > 0 ? encodeImportedThreadCursor(Math.max(0, offset - limit)) : null,
    },
  };
}

function encodeImportedThreadCursor(offset: number): string {
  return `fields-import-v1.${Buffer.from(JSON.stringify({ offset })).toString("base64url")}`;
}

function decodeImportedThreadCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  if (!cursor.startsWith("fields-import-v1.")) throw new MemberRuntimeError("home_thread_cursor_invalid", "Home Thread cursor is not valid for imported conversations.");
  try {
    const value = JSON.parse(Buffer.from(cursor.slice("fields-import-v1.".length), "base64url").toString("utf8")) as { offset?: unknown };
    if (!Number.isSafeInteger(value.offset) || Number(value.offset) < 0) throw new Error("invalid offset");
    return Number(value.offset);
  } catch {
    throw new MemberRuntimeError("home_thread_cursor_invalid", "Home Thread cursor is invalid.");
  }
}

function importedMemberThreadRecord(record: ImportedThreadIndexRecord, workspace: string): MemberThreadRecord {
  return {
    key: `home:${record.threadId}`,
    roomId: null,
    threadId: record.threadId,
    workspaceRoots: [workspace],
    homeBranch: {
      rootThreadId: record.rootThreadId,
      sourceThreadId: record.sourceThreadId,
      anchorTurnId: record.anchorTurnId,
      kind: record.branchKind,
      selectedThreadId: record.selectedThreadId,
      revision: 1,
      createdAtMs: record.createdAtMs,
    },
  };
}

function homeProjectWorkspace(member: ManagedMember, projectId: string): string {
  if (!/^project_[0-9a-f-]{36}$/.test(projectId)) {
    throw new MemberRuntimeError("home_project_id_invalid", "Home Project id is invalid.");
  }
  return join(member.layout.workspace, "projects", projectId);
}

async function ensureHomeProjectsRoot(member: ManagedMember): Promise<void> {
  const root = join(member.layout.workspace, "projects");
  try {
    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new MemberRuntimeError("home_projects_root_invalid", "Home Projects root must be a real directory.");
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    await mkdir(root, { mode: 0o700 });
  }
}

async function requireHomeProjectWorkspace(member: ManagedMember, projectId: string): Promise<string> {
  const workspace = homeProjectWorkspace(member, projectId);
  const metadata = await lstat(workspace);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new MemberRuntimeError("home_project_workspace_invalid", "Project workspace must be a real directory.");
  }
  return workspace;
}

function homeProjectData(project: HomeProjectRecord) {
  return {
    project_id: project.projectId,
    name: project.name,
    created_at_ms: project.createdAtMs,
    updated_at_ms: project.updatedAtMs,
  };
}

function homeProjectImportedIndex(
  member: ManagedMember,
  index: ImportedConversationIndex,
  projectId: string | null,
): ImportedConversationIndex {
  return {
    records: index.records.filter((record) => (
      member.threads.get(`home:${record.threadId}`)?.homeProjectId ?? null
    ) === projectId),
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function homeCodexRuntimeEvent(
  memberId: string,
  threadId: string,
  event: CodexAppServerRawEvent,
): CodexAgentRuntimeEnvelope {
  const base = {
    schema_version: 1,
    event_id: randomUUID(),
    provider: "codex",
    source: "company-runtime",
    scope: {
      type: "home" as const,
      member_id: memberId,
      thread_id: threadId,
    },
    turn_id: event.turnId,
    method: event.method,
    item_id: event.itemId,
    payload: event.payload,
    occurred_at_ms: event.occurredAtMs,
  };
  if (event.requestId !== null && isCodexInteractionRequestMethod(event.method)) {
    return {
      ...base,
      schema_version: 1 as const,
      provider: "codex" as const,
      source: "company-runtime" as const,
      type: "agent_runtime.interaction_request",
      method: event.method,
      request_id: event.requestId,
    };
  }
  return {
    ...base,
    schema_version: 1 as const,
    provider: "codex" as const,
    source: "company-runtime" as const,
    type: "agent_runtime.event",
  };
}

function roomCodexRuntimeEvent(
  memberId: string,
  roomId: string,
  executionId: string,
  event: CodexAppServerRawEvent,
): RoomCodexAgentRuntimeEnvelope {
  const base = {
    schema_version: 1 as const,
    event_id: randomUUID(),
    provider: "codex" as const,
    source: "company-runtime" as const,
    scope: {
      type: "room" as const,
      room_id: roomId,
      agent_member_id: memberId,
      execution_id: executionId,
    },
    turn_id: event.turnId,
    item_id: event.itemId,
    occurred_at_ms: event.occurredAtMs,
    payload: event.payload,
  };
  if (
    event.requestId !== null
    && isCodexInteractionRequestMethod(event.method)
  ) {
    return {
      ...base,
      type: "agent_runtime.interaction_request",
      method: event.method,
      request_id: event.requestId,
    };
  }
  return {
    ...base,
    type: "agent_runtime.event",
    method: event.method,
  };
}

function roomResolvedInteractionEvent(
  memberId: string,
  roomId: string,
  executionId: string,
  event: CodexAppServerRawEvent,
  interactionId: string,
): RoomCodexAgentRuntimeEnvelope {
  return {
    schema_version: 1,
    event_id: randomUUID(),
    provider: "codex",
    source: "company-runtime",
    type: "agent_runtime.event",
    scope: { type: "room", room_id: roomId, agent_member_id: memberId, execution_id: executionId },
    turn_id: event.turnId,
    method: "fields/questionInteractionResolved",
    item_id: event.itemId,
    payload: { interaction_id: interactionId },
    occurred_at_ms: event.occurredAtMs,
  };
}

function roomRequestKey(executionId: string, requestId: string | number): string {
  return `${executionId}\0${String(requestId)}`;
}

function isCodexInteractionRequestMethod(
  method: string,
): method is CodexAgentRuntimeInteractionRequestMethod {
  return method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
    || method === "item/permissions/requestApproval"
    || method === "applyPatchApproval"
    || method === "execCommandApproval"
    || method === "item/tool/requestUserInput";
}

export function codexInteractionResponse(
  method: CodexAgentRuntimeInteractionRequestMethod,
  payload: unknown,
  response: AgentRoomInteractionResponseDispatch["response"],
): Record<string, unknown> {
  if (method === "item/tool/requestUserInput") {
    if (typeof response === "string") {
      throw new MemberRuntimeError("interaction_response_invalid", "Question interactions require answers.");
    }
    return {
      answers: Object.fromEntries(Object.entries(response.answers).map(([id, answers]) => [id, { answers }])),
    };
  }
  if (typeof response !== "string") {
    throw new MemberRuntimeError("interaction_response_invalid", "Approval interactions require a decision.");
  }
  if (
    method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
  ) {
    return { decision: response === "approve" ? "accept" : "decline" };
  }
  if (method === "item/permissions/requestApproval") {
    const permissions = asRecord(payload)?.permissions;
    return {
      permissions: response === "approve" && isRecordValue(permissions)
        ? {
          ...(permissions.network === null ? {} : { network: permissions.network }),
          ...(permissions.fileSystem === null ? {} : { fileSystem: permissions.fileSystem }),
        }
        : {},
      scope: "turn",
    };
  }
  return {
    decision: response === "approve"
      ? "approved"
      : { denied: { rejection: "Rejected through the Fields Room interaction." } },
  };
}

function interactionResponseFingerprint(
  dispatch: AgentRoomInteractionResponseDispatch,
): string {
  return JSON.stringify({
    persisted_response_id: dispatch.persisted_response_id,
    execution_id: dispatch.execution_id,
    room_id: dispatch.room_id,
    agent_member_id: dispatch.agent_member_id,
    message_id: dispatch.message_id,
    interaction_id: dispatch.interaction_id,
    responder_member_id: dispatch.responder_member_id,
    response: dispatch.response,
    responded_at_ms: dispatch.responded_at_ms,
  });
}

function cleanupResult(
  operationId: string,
  memberId: string,
  duplicate: boolean,
): CompanyRuntimeMemberCleanupResult {
  return {
    accepted: true,
    operation_id: operationId,
    member_id: memberId,
    duplicate,
  };
}

function optionalPromise<T>(promise: Promise<T> | undefined): Promise<T>[] {
  return promise ? [promise] : [];
}

function assertInteractionResponseFingerprint(
  existing: string,
  candidate: string,
): void {
  if (existing !== candidate) {
    throw new MemberRuntimeError(
      "interaction_response_idempotency_conflict",
      "The interaction response idempotency key was reused with different content.",
    );
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function secondsToMs(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.trunc(value * 1_000));
}
