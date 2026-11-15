import type {
  AgentRoomInteractionResponseAccepted,
  AgentRoomInteractionResponseDispatch,
} from "@fields/contracts/internal/agent-room";
import type {
  HomeFilesystemCreateInput,
  HomeFilesystemDeleteInput,
  HomeFilesystemDeleteResult,
  HomeFilesystemEntry,
  HomeFilesystemEventsInput,
  HomeFilesystemListInput,
  HomeFilesystemListResult,
  HomeFilesystemRenameInput,
  HomeModelOptionsInput,
  HomeModelOptionsResult,
  HomeProject,
  HomeProjectCreateInput,
  HomeProjectDeleteInput,
  HomeProjectDeleteResult,
  HomeProjectListInput,
  HomeProjectListResult,
  HomeProjectThreadMoveInput,
  HomeProjectThreadMoveResult,
  HomeProjectUpdateInput,
  HomeThreadListInput,
  HomeThreadListResult,
  HomeThreadDeleteInput,
  HomeThreadDeleteResult,
  HomeThreadForkInput,
  HomeThreadForkResult,
  HomeThreadReadInput,
  HomeThreadReadResult,
  HomeThreadSelectInput,
  HomeThreadSelectResult,
  HomeThreadSearchInput,
  HomeThreadSearchResult,
  HomeThreadSettingsInput,
  HomeThreadSettingsResult,
  HomeThreadSettingsSetInput,
  HomeTurnEventsInput,
  HomeTurnSubmitInput,
  HomeTurnSubmitResult,
  HomeQuestionInteractionRespondInput,
  HomeQuestionInteractionRespondResult,
  HomeQuestionInteractionSnoozeInput,
  HomeConversationImport,
} from "@fields/contracts/public/home";
import type {
  CompanyProxyDisableInput,
  CompanyProxySetInput,
  CompanyProxyStatus,
  ExecutorModelPolicyItem,
} from "@fields/contracts/public/executor";
import type {
  HomeFilesystemSearchInput,
  HomeFilesystemSearchResult,
} from "@fields/contracts/public/search";
import type {
  CompanyExecutorCredentialUpdatedInput,
  CompanyExecutorUnavailableInput,
  CompanyRuntimeFailedInput,
  CompanyRuntimeHeartbeatInput,
  CompanyRuntimeIdentity,
} from "@fields/contracts/internal/company-runtime";
import type {
  RoomSideChatTurnSubmitInput,
} from "@fields/contracts/public/room-side-chat";

export const MEMBER_EXECUTOR_NOT_FOUND_CODE = "MEMBER_EXECUTOR_NOT_FOUND";

export type MemberExecutorSummary = {
  executorId: string;
  ownerMemberId: string;
  ownerDisplayName: string;
  name: string;
  sharingState: "private" | "company_shared" | "admin_blocked";
  availability: "available" | "pending_auth" | "configuration_required" | "unavailable" | "disconnected";
  executorType: "codex";
  configurationStatus: "pending" | "validating" | "ready" | "invalid";
  configurationRevision: number;
  allowedModels: ExecutorModelPolicyItem[];
  allowedReasoningEfforts: string[];
  defaultModel: string | null;
  defaultReasoningEffort: string | null;
  catalogCheckedAtMs: number | null;
  configurationUpdatedAtMs: number | null;
  authorization:
    | { method: "chatgpt"; planType: string | null }
    | { method: "custom_api_key" };
};

export type MemberExecutorAssignment = {
  companyId: string;
  memberId: string;
  executor: MemberExecutorSummary;
  assignmentVersion: number;
  state: "ready" | "switching" | "configuration_required" | "auth_required" | "failed";
  pendingExecutorId: string | null;
  switchOperationId: string | null;
  lastErrorCode: string | null;
  lastErrorRetryable: boolean | null;
  updatedAtMs: number;
};

export interface MemberExecutorAssignmentApplication {
  read(input: {
    companyId: string;
    memberId: string;
    authority: { kind: "self" | "company_owner"; requestedByMemberId: string };
  }): Promise<MemberExecutorAssignment>;
  listOptions(input: {
    companyId: string;
    memberId: string;
    authority: { kind: "self" | "company_owner"; requestedByMemberId: string };
  }): Promise<readonly MemberExecutorSummary[]>;
  set(input: {
    companyId: string;
    memberId: string;
    executorId: string;
    authority: { kind: "self" | "company_owner"; requestedByMemberId: string };
  }): Promise<MemberExecutorAssignment>;
}

export type CompanyRuntimeStatus = {
  companyId: string;
  status: "pending" | "provisioning" | "initializing" | "ready" | "degraded" | "failed";
  lastHeartbeatAtMs: number | null;
  memberAppServers: {
    running: number;
    idle: number;
    switching: number;
    failed: number;
  };
  activeExecutionCount: number;
  error: { code: string; retryable: boolean } | null;
};

export interface CompanyRuntimeStatusQuery {
  read(input: {
    companyId: string;
    requestedByMemberId: string;
  }): Promise<CompanyRuntimeStatus>;
}

export interface CompanyRuntimeCallbackRepository {
  authorize(identity: CompanyRuntimeIdentity, bearerToken: string): Promise<void>;
  recordReady(identity: CompanyRuntimeIdentity, nowMs: number): Promise<void>;
  recordHeartbeat(input: CompanyRuntimeHeartbeatInput): Promise<void>;
  recordFailed(input: CompanyRuntimeFailedInput): Promise<void>;
  recordCredentialUpdated(input: CompanyExecutorCredentialUpdatedInput): Promise<void>;
  recordExecutorUnavailable(input: CompanyExecutorUnavailableInput): Promise<void>;
}

export interface CompanyRuntimePublicGateway {
  memberMemoryApply(companyId: string, input: {
    memberId: string;
    operationId: string;
    enabled: boolean;
    previousEnabled: boolean;
  }): Promise<{ accepted: true }>;
  companyProxyStatus(companyId: string): Promise<CompanyProxyStatus>;
  setCompanyProxy(companyId: string, input: CompanyProxySetInput): Promise<CompanyProxyStatus>;
  disableCompanyProxy(companyId: string, input: CompanyProxyDisableInput): Promise<CompanyProxyStatus>;
  homeModelOptions(companyId: string, memberId: string, input: HomeModelOptionsInput): Promise<HomeModelOptionsResult>;
  homeProjectList(companyId: string, memberId: string, input: HomeProjectListInput): Promise<HomeProjectListResult>;
  homeProjectCreate(companyId: string, memberId: string, input: HomeProjectCreateInput): Promise<HomeProject>;
  homeProjectUpdate(companyId: string, memberId: string, input: HomeProjectUpdateInput): Promise<HomeProject>;
  homeProjectDelete(companyId: string, memberId: string, input: HomeProjectDeleteInput): Promise<HomeProjectDeleteResult>;
  homeProjectThreadMove(companyId: string, memberId: string, input: HomeProjectThreadMoveInput): Promise<HomeProjectThreadMoveResult>;
  homeThreadList(companyId: string, memberId: string, input: HomeThreadListInput): Promise<HomeThreadListResult>;
  homeThreadDelete(companyId: string, memberId: string, input: HomeThreadDeleteInput): Promise<HomeThreadDeleteResult>;
  homeThreadFork(companyId: string, memberId: string, input: HomeThreadForkInput): Promise<HomeThreadForkResult>;
  homeThreadSearch(companyId: string, memberId: string, input: HomeThreadSearchInput): Promise<HomeThreadSearchResult>;
  homeThreadRead(companyId: string, memberId: string, input: HomeThreadReadInput): Promise<HomeThreadReadResult>;
  homeThreadSelect(companyId: string, memberId: string, input: HomeThreadSelectInput): Promise<HomeThreadSelectResult>;
  homeThreadSettings(companyId: string, memberId: string, input: HomeThreadSettingsInput): Promise<HomeThreadSettingsResult>;
  homeConversationImportRead(companyId: string, memberId: string, importId: string): Promise<HomeConversationImport>;
  setHomeThreadSettings(companyId: string, memberId: string, input: HomeThreadSettingsSetInput): Promise<HomeThreadSettingsResult>;
  homeTurnSubmit(
    companyId: string,
    memberId: string,
    input: HomeTurnSubmitInput & {
      builder_scope?: { kind: "agent" | "asset"; topic_id: string };
      developer_instructions?: string;
    },
  ): Promise<HomeTurnSubmitResult>;
  roomSideChatTurnSubmit(
    companyId: string,
    memberId: string,
    input: RoomSideChatTurnSubmitInput & {
      thread_id?: string | null;
      developer_instructions: string;
    },
  ): Promise<HomeTurnSubmitResult>;
  roomSideChatThreadRead(
    companyId: string,
    memberId: string,
    roomId: string,
    threadId: string,
  ): Promise<HomeThreadReadResult>;
  homeFilesystemList(companyId: string, memberId: string, input: HomeFilesystemListInput): Promise<HomeFilesystemListResult>;
  homeFilesystemSearch(companyId: string, memberId: string, input: HomeFilesystemSearchInput): Promise<HomeFilesystemSearchResult>;
  homeFilesystemCreate(companyId: string, memberId: string, input: HomeFilesystemCreateInput): Promise<HomeFilesystemEntry>;
  homeFilesystemRename(companyId: string, memberId: string, input: HomeFilesystemRenameInput): Promise<HomeFilesystemEntry>;
  homeFilesystemDelete(companyId: string, memberId: string, input: HomeFilesystemDeleteInput): Promise<HomeFilesystemDeleteResult>;
  respondAgentRoomInteraction(
    companyId: string,
    input: AgentRoomInteractionResponseDispatch,
  ): Promise<AgentRoomInteractionResponseAccepted>;
  homeQuestionInteractionRespond(
    companyId: string,
    memberId: string,
    input: HomeQuestionInteractionRespondInput,
  ): Promise<HomeQuestionInteractionRespondResult>;
  homeQuestionInteractionSnooze(
    companyId: string,
    memberId: string,
    input: HomeQuestionInteractionSnoozeInput,
  ): Promise<{ accepted: true; deadline_at_ms: number }>;
  watchHomeTurnEvents(
    companyId: string,
    memberId: string,
    input: HomeTurnEventsInput,
    signal?: AbortSignal,
  ): AsyncIterable<unknown>;
  watchAllHomeTurnEvents(companyId: string, memberId: string, signal?: AbortSignal): AsyncIterable<unknown>;
  watchRoomSideChatTurnEvents(
    companyId: string,
    memberId: string,
    roomId: string,
    signal?: AbortSignal,
  ): AsyncIterable<unknown>;
  watchHomeFilesystemEvents(
    companyId: string,
    memberId: string,
    input: HomeFilesystemEventsInput,
    signal?: AbortSignal,
  ): AsyncIterable<unknown>;
}
