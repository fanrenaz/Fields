import { z } from "zod";
import {
  companyFileDownloadResultSchema,
  companyFileListInputSchema,
  companyFileListResultSchema,
  companyFileSchema,
  companyFileUploadBeginInputSchema,
  companyFileUploadFinalizeInputSchema,
} from "../public/company-file.js";

import {
  publicOperationErrorSchema,
  type PublicOperationError,
} from "../public/company.js";
import {
  companyProxyDisableInputSchema,
  companyProxySetInputSchema,
  companyProxyStatusSchema,
  memberExecutorSessionStateSchema,
  executorModelPolicyItemSchema,
  type CompanyProxyDisableInput,
  type CompanyProxySetInput,
  type CompanyProxyStatus,
  type MemberExecutorSessionState,
} from "../public/executor.js";
import {
  homeFilesystemCreateInputSchema,
  homeFilesystemDeleteInputSchema,
  homeFilesystemEventsInputSchema,
  homeFilesystemListInputSchema,
  homeFilesystemRenameInputSchema,
  homeModelOptionsInputSchema,
  homeProjectCreateInputSchema,
  homeProjectDeleteInputSchema,
  homeProjectListInputSchema,
  homeProjectThreadMoveInputSchema,
  homeProjectUpdateInputSchema,
  homeThreadListInputSchema,
  homeThreadDeleteInputSchema,
  homeThreadForkInputSchema,
  homeThreadReadInputSchema,
  homeThreadSelectInputSchema,
  homeThreadSearchInputSchema,
  homeThreadSettingsInputSchema,
  homeThreadSettingsSetInputSchema,
  homeTurnEventsInputSchema,
  homeQuestionInteractionRespondInputSchema,
  homeQuestionInteractionSnoozeInputSchema,
  homeConversationImportReadInputSchema,
  homeTurnSubmitInputSchema,
  type HomeFilesystemCreateInput,
  type HomeFilesystemDeleteInput,
  type HomeFilesystemEventsInput,
  type HomeFilesystemListInput,
  type HomeFilesystemRenameInput,
  type HomeProjectCreateInput,
  type HomeProjectDeleteInput,
  type HomeProjectThreadMoveInput,
  type HomeProjectUpdateInput,
  type HomeThreadListInput,
  type HomeThreadDeleteInput,
  type HomeQuestionInteractionRespondInput,
  type HomeQuestionInteractionSnoozeInput,
  type HomeThreadForkInput,
  type HomeThreadReadInput,
  type HomeThreadSelectInput,
  type HomeThreadSearchInput,
  type HomeThreadSettingsInput,
  type HomeThreadSettingsSetInput,
  type HomeTurnEventsInput,
  type HomeTurnSubmitInput,
  type HomeConversationImportReadInput,
} from "../public/home.js";
import {
  globalSearchInputSchema,
  globalSearchResultSchema,
  homeFilesystemSearchInputSchema,
  type GlobalSearchInput,
  type GlobalSearchResult,
  type HomeFilesystemSearchInput,
} from "../public/search.js";
import {
  agentRoomExecutionCompletionSchema,
  agentRoomExecutionDispatchSchema,
  agentRoomExecutionProgressSchema,
  agentRoomInteractionResponseDispatchSchema,
} from "./agent-room.js";
import { roomCodexAgentRuntimeEnvelopeSchema } from "./agent-runtime.js";

export const companyRuntimeIdentitySchema = z.strictObject({
  company_id: z.string().min(1),
});
export type CompanyRuntimeIdentity = z.infer<typeof companyRuntimeIdentitySchema>;

export const companyRuntimeLayoutSchema = z.strictObject({
  members_root: z.string().min(1),
  rooms_root: z.string().min(1),
  executors_root: z.string().min(1),
});
export type CompanyRuntimeLayout = z.infer<typeof companyRuntimeLayoutSchema>;

export const companyRuntimeStoragePolicySchema = z.strictObject({
  member_workspace_pattern: z.literal("members/<member_id>/workspace"),
  codex_home_directory: z.literal(".codex"),
  room_file_inputs: z.literal("execution_scoped_company_file_snapshots"),
  executor_credentials_pattern: z.literal("executors/<executor_id>/credentials"),
  codex_home_auth_json: z.literal("forbidden"),
  codex_home_visibility: z.literal("excluded_from_files_search_upload_export_git"),
});
export type CompanyRuntimeStoragePolicy = z.infer<typeof companyRuntimeStoragePolicySchema>;

export const companyRuntimeExecutionPolicySchema = z.strictObject({
  idle_timeout_ms: z.literal(1_800_000),
  same_agent_room_thread: z.literal("serial"),
  different_room_threads: z.literal("parallel"),
  thread_recovery: z.literal("resume"),
  executor_auth: z.literal("chatgptAuthTokens"),
});
export type CompanyRuntimeExecutionPolicy = z.infer<typeof companyRuntimeExecutionPolicySchema>;

export const companyRuntimeInitInputSchema = companyRuntimeIdentitySchema.extend({
  backend_callback_url: z.string().url(),
  runtime_callback_token: z.string().min(1),
  layout: companyRuntimeLayoutSchema,
  storage_policy: companyRuntimeStoragePolicySchema,
  execution_policy: companyRuntimeExecutionPolicySchema,
});
export type CompanyRuntimeInitInput = z.infer<typeof companyRuntimeInitInputSchema>;

export const companyRuntimeInitResultSchema = companyRuntimeIdentitySchema.extend({
  initialized: z.literal(true),
  layout: companyRuntimeLayoutSchema,
  storage_policy: companyRuntimeStoragePolicySchema,
  execution_policy: companyRuntimeExecutionPolicySchema,
});
export type CompanyRuntimeInitResult = z.infer<typeof companyRuntimeInitResultSchema>;

export const companyRuntimeStateSchema = z.enum([
  "starting",
  "ready",
  "degraded",
  "stopping",
  "failed",
]);
export type CompanyRuntimeState = z.infer<typeof companyRuntimeStateSchema>;

export const memberAppServerStateSchema = z.enum([
  "starting",
  "ready",
  "idle",
  "switching",
  "auth_required",
  "failed",
  "stopped",
]);
export type MemberAppServerState = z.infer<typeof memberAppServerStateSchema>;

export const fieldsCorePluginStatusSchema = z.strictObject({
  plugin_id: z.literal("fields-core@fields"),
  plugin_name: z.literal("fields-core"),
  marketplace_name: z.literal("fields"),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u),
  installed: z.literal(true),
  enabled: z.literal(true),
  mcp_server_names: z.tuple([
    z.literal("fields_embodiment"),
    z.literal("fields_search"),
    z.literal("fields_room_messages"),
    z.literal("fields_assets"),
    z.literal("fields_mail"),
  ]),
});
export type FieldsCorePluginStatus = z.infer<typeof fieldsCorePluginStatusSchema>;

export const memberAppServerStatusSchema = z.strictObject({
  member_id: z.string().min(1),
  state: memberAppServerStateSchema,
  executor_id: z.string().min(1).nullable(),
  credential_version: z.number().int().positive().nullable(),
  active_turn_count: z.number().int().nonnegative(),
  last_active_at_ms: z.number().int().nonnegative().nullable(),
  idle_deadline_at_ms: z.number().int().nonnegative().nullable(),
  plugin: fieldsCorePluginStatusSchema.nullable(),
  error: publicOperationErrorSchema.nullable(),
});
export type MemberAppServerStatus = z.infer<typeof memberAppServerStatusSchema>;

export const companyRuntimeHeartbeatInputSchema = companyRuntimeIdentitySchema.extend({
  state: companyRuntimeStateSchema,
  member_app_servers: z.array(memberAppServerStatusSchema),
  active_execution_count: z.number().int().nonnegative(),
  occurred_at_ms: z.number().int().nonnegative(),
});
export type CompanyRuntimeHeartbeatInput = z.infer<typeof companyRuntimeHeartbeatInputSchema>;

export const companyRuntimeFailedInputSchema = companyRuntimeIdentitySchema.extend({
  error: publicOperationErrorSchema,
  occurred_at_ms: z.number().int().nonnegative(),
});
export type CompanyRuntimeFailedInput = z.infer<typeof companyRuntimeFailedInputSchema>;

export const companyRuntimeProxyStatusSchema = companyProxyStatusSchema;
export type CompanyRuntimeProxyStatus = CompanyProxyStatus;

export const companyRuntimeProxySetInputSchema = companyProxySetInputSchema;
export type CompanyRuntimeProxySetInput = CompanyProxySetInput;

export const companyRuntimeProxyDisableInputSchema = companyProxyDisableInputSchema;
export type CompanyRuntimeProxyDisableInput = CompanyProxyDisableInput;

export const companyExecutorAuthStartInputSchema = z.strictObject({
  executor_id: z.string().min(1),
  attempt_id: z.string().min(1),
});
export type CompanyExecutorAuthStartInput = z.infer<typeof companyExecutorAuthStartInputSchema>;

export const companyExecutorAuthStartResultSchema = z.strictObject({
  attempt_id: z.string().min(1),
  login_id: z.string().min(1),
  verification_url: z.string().url(),
  user_code: z.string().min(1),
});
export type CompanyExecutorAuthStartResult = z.infer<typeof companyExecutorAuthStartResultSchema>;

export const companyExecutorAuthAttemptInputSchema = z.strictObject({
  executor_id: z.string().min(1),
  attempt_id: z.string().min(1),
});
export type CompanyExecutorAuthAttemptInput = z.infer<typeof companyExecutorAuthAttemptInputSchema>;

export const companyExecutorAuthStatusResultSchema = z.strictObject({
  attempt_id: z.string().min(1),
  status: z.enum(["pending", "completed", "cancelled", "failed"]),
  login_id: z.string().min(1).nullable(),
  verification_url: z.string().url().nullable(),
  user_code: z.string().min(1).nullable(),
  error: publicOperationErrorSchema.nullable(),
});
export type CompanyExecutorAuthStatusResult = z.infer<typeof companyExecutorAuthStatusResultSchema>;

export const companyExecutorAuthCancelResultSchema = z.strictObject({
  attempt_id: z.string().min(1),
  status: z.literal("cancelled"),
});
export type CompanyExecutorAuthCancelResult = z.infer<typeof companyExecutorAuthCancelResultSchema>;

const customApiBaseUrlSchema = z.string().trim().min(1).max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, { message: "base_url must be an HTTPS URL without embedded credentials" });
const customApiKeySchema = z.string().min(1).max(8192).refine(
  (value) => value.trim().length > 0,
  { message: "api_key must not be blank" },
);

export const companyExecutorCustomApiConfigureInputSchema = z.strictObject({
  executor_id: z.string().min(1),
  base_url: customApiBaseUrlSchema,
  api_key: customApiKeySchema,
  previous_credential_version: z.number().int().nonnegative(),
});
export type CompanyExecutorCustomApiConfigureInput = z.infer<typeof companyExecutorCustomApiConfigureInputSchema>;

export const companyExecutorCustomApiConfigureResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  credential_version: z.number().int().positive(),
  endpoint_host: z.string().min(1).max(512),
});
export type CompanyExecutorCustomApiConfigureResult = z.infer<typeof companyExecutorCustomApiConfigureResultSchema>;

export const companyExecutorModelCatalogInputSchema = z.strictObject({
  executor_id: z.string().min(1),
});
export type CompanyExecutorModelCatalogInput = z.infer<typeof companyExecutorModelCatalogInputSchema>;

export const companyExecutorModelCatalogResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  items: z.array(executorModelPolicyItemSchema),
});
export type CompanyExecutorModelCatalogResult = z.infer<typeof companyExecutorModelCatalogResultSchema>;

export const companyExecutorModelValidationInputSchema = z.strictObject({
  executor_id: z.string().min(1),
  models: z.array(executorModelPolicyItemSchema.pick({
    model: true,
    display_name: true,
    source: true,
    supported_reasoning_efforts: true,
  })).min(1),
});
export type CompanyExecutorModelValidationInput = z.infer<typeof companyExecutorModelValidationInputSchema>;

export const companyExecutorModelValidationResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  items: z.array(executorModelPolicyItemSchema),
});
export type CompanyExecutorModelValidationResult = z.infer<typeof companyExecutorModelValidationResultSchema>;

export const companyExecutorCredentialCleanupInputSchema = z.strictObject({
  executor_id: z.string().min(1),
});
export type CompanyExecutorCredentialCleanupInput = z.infer<typeof companyExecutorCredentialCleanupInputSchema>;

export const companyExecutorCredentialCleanupResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  cleaned: z.literal(true),
});
export type CompanyExecutorCredentialCleanupResult = z.infer<typeof companyExecutorCredentialCleanupResultSchema>;

export const companyExecutorTokenIssueInputSchema = z.strictObject({
  executor_id: z.string().min(1),
  previous_credential_version: z.number().int().nonnegative().optional(),
  reason: z.enum(["app_server_start", "app_server_refresh", "executor_switch", "authorization"]),
});
export type CompanyExecutorTokenIssueInput = z.infer<typeof companyExecutorTokenIssueInputSchema>;

export const companyExecutorTokenIssueResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  credential_version: z.number().int().positive(),
  credential: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("chatgpt_auth_tokens"),
      access_token: z.string().min(1),
      account_id: z.string().min(1).max(255),
      plan_type: z.string().min(1).max(128),
    }),
    z.strictObject({
      type: z.literal("custom_api_key"),
      base_url: z.string().min(1).max(2048),
      api_key: z.string().min(1).max(8192),
    }),
  ]),
});
export type CompanyExecutorTokenIssueResult = z.infer<typeof companyExecutorTokenIssueResultSchema>;

export const companyExecutorCredentialUpdatedInputSchema = companyRuntimeIdentitySchema.extend({
  executor_id: z.string().min(1),
  credential_version: z.number().int().positive(),
  authorization: z.discriminatedUnion("method", [
    z.strictObject({
      method: z.literal("chatgpt"),
      account_id: z.string().min(1).max(255),
      plan_type: z.string().min(1).max(128),
    }),
    z.strictObject({
      method: z.literal("custom_api_key"),
      endpoint_host: z.string().min(1).max(512),
    }),
  ]),
  occurred_at_ms: z.number().int().nonnegative(),
});
export type CompanyExecutorCredentialUpdatedInput = z.infer<typeof companyExecutorCredentialUpdatedInputSchema>;

export const companyExecutorUnavailableInputSchema = companyRuntimeIdentitySchema.extend({
  executor_id: z.string().min(1),
  credential_version: z.number().int().nonnegative(),
  reason: z.enum(["disconnected", "expired", "revoked", "invalid_credentials", "credential_missing", "runtime_failed"]),
  occurred_at_ms: z.number().int().nonnegative(),
});
export type CompanyExecutorUnavailableInput = z.infer<typeof companyExecutorUnavailableInputSchema>;

export const memberAppServerInputSchema = z.strictObject({
  member_id: z.string().min(1),
});
export type MemberAppServerInput = z.infer<typeof memberAppServerInputSchema>;

export const memberAppServerStartInputSchema = memberAppServerInputSchema.extend({
  executor_id: z.string().min(1),
  credential_version: z.number().int().positive(),
  memory_enabled: z.boolean(),
  memory_managed: z.boolean(),
  memory_model: z.string().trim().min(1).max(512),
});
export type MemberAppServerStartInput = z.infer<typeof memberAppServerStartInputSchema>;

export const memberAppServerStopResultSchema = z.strictObject({
  member_id: z.string().min(1),
  stopped: z.literal(true),
});
export type MemberAppServerStopResult = z.infer<typeof memberAppServerStopResultSchema>;

export const companyRuntimeMemberCleanupInputSchema = companyRuntimeIdentitySchema.extend({
  operation_id: z.string().min(1),
  member_id: z.string().min(1),
});
export type CompanyRuntimeMemberCleanupInput = z.infer<typeof companyRuntimeMemberCleanupInputSchema>;

export const companyRuntimeMemberCleanupResultSchema = z.strictObject({
  accepted: z.literal(true),
  operation_id: z.string().min(1),
  member_id: z.string().min(1),
  duplicate: z.boolean(),
});
export type CompanyRuntimeMemberCleanupResult = z.infer<typeof companyRuntimeMemberCleanupResultSchema>;

export const memberExecutorSwitchInputSchema = z.strictObject({
  member_id: z.string().min(1),
  assignment_version: z.number().int().positive(),
  current_executor_id: z.string().min(1).nullable(),
  target_executor_id: z.string().min(1),
  target_credential_version: z.number().int().positive(),
  target_memory_enabled: z.boolean(),
  target_memory_managed: z.boolean(),
  target_memory_model: z.string().trim().min(1).max(512),
  codex_thread_ids: z.array(z.string().min(1)),
});
export type MemberExecutorSwitchInput = z.infer<typeof memberExecutorSwitchInputSchema>;

export type MemberExecutorSwitchResult = {
  member_id: string;
  assignment_version: number;
  outcome: "switched" | "rolled_back";
  session_state: MemberExecutorSessionState;
  executor_id: string | null;
  resumed_codex_thread_ids: string[];
  error: PublicOperationError | null;
};

export const memberExecutorSwitchResultSchema:
z.ZodType<MemberExecutorSwitchResult, MemberExecutorSwitchResult> = z.strictObject({
  member_id: z.string().min(1),
  assignment_version: z.number().int().positive(),
  outcome: z.enum(["switched", "rolled_back"]),
  session_state: memberExecutorSessionStateSchema,
  executor_id: z.string().min(1).nullable(),
  resumed_codex_thread_ids: z.array(z.string().min(1)),
  error: publicOperationErrorSchema.nullable(),
}).superRefine((result, context) => {
  if (result.outcome === "switched" && (result.session_state !== "ready" || result.error !== null)) {
    context.addIssue({ code: "custom", message: "A successful Executor switch must finish ready without an error." });
  }
  if (result.outcome === "rolled_back" && result.error === null) {
    context.addIssue({ code: "custom", path: ["error"], message: "A rolled-back Executor switch requires an error." });
  }
});

export const companyRuntimeAgentRoomExecuteInputSchema = companyRuntimeIdentitySchema.extend({
  dispatch: agentRoomExecutionDispatchSchema,
});
export type CompanyRuntimeAgentRoomExecuteInput = z.infer<typeof companyRuntimeAgentRoomExecuteInputSchema>;

export const companyRuntimeAgentExecutionProgressInputSchema = companyRuntimeIdentitySchema.extend({
  progress: agentRoomExecutionProgressSchema,
});
export type CompanyRuntimeAgentExecutionProgressInput = z.infer<typeof companyRuntimeAgentExecutionProgressInputSchema>;

export const companyRuntimeAgentExecutionCompletionInputSchema = companyRuntimeIdentitySchema.extend({
  completion: agentRoomExecutionCompletionSchema,
});
export type CompanyRuntimeAgentExecutionCompletionInput = z.infer<typeof companyRuntimeAgentExecutionCompletionInputSchema>;

export const companyRuntimeRoomMessagesResourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("latest") }),
  z.strictObject({
    kind: z.literal("before"),
    sequence: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("around"),
    message_id: z.string().min(1),
  }),
]);
export type CompanyRuntimeRoomMessagesResource = z.infer<typeof companyRuntimeRoomMessagesResourceSchema>;

export const companyRuntimeRoomMessagesReadInputSchema = companyRuntimeIdentitySchema.extend({
  member_id: z.string().min(1),
  room_id: z.string().min(1),
  access_mode: z.enum(["agent_execution", "human_side_chat"]),
  resource: companyRuntimeRoomMessagesResourceSchema,
});
export type CompanyRuntimeRoomMessagesReadInput = z.infer<typeof companyRuntimeRoomMessagesReadInputSchema>;

export const companyRuntimeRoomMessagesReadResultSchema = z.strictObject({
  uri: z.string().url(),
  mime_type: z.literal("text/markdown"),
  text: z.string(),
});
export type CompanyRuntimeRoomMessagesReadResult = z.infer<typeof companyRuntimeRoomMessagesReadResultSchema>;

export const companyRuntimeSearchQueryInputSchema = companyRuntimeIdentitySchema.extend({
  member_id: z.string().min(1),
  query: globalSearchInputSchema,
});
export type CompanyRuntimeSearchQueryInput = Omit<
  z.infer<typeof companyRuntimeSearchQueryInputSchema>,
  "query"
> & {
  query: GlobalSearchInput;
};

export const companyRuntimeSearchQueryResultSchema = globalSearchResultSchema;
export type CompanyRuntimeSearchQueryResult = GlobalSearchResult;

export const companyRuntimeFileListInputSchema = companyRuntimeIdentitySchema.extend({
  member_id: z.string().min(1),
  input: companyFileListInputSchema,
});
export const companyRuntimeFileReadInputSchema = companyRuntimeIdentitySchema.extend({
  member_id: z.string().min(1),
  input: z.strictObject({
    file_id: z.string().trim().min(1).max(128),
    version_id: z.string().trim().min(1).max(128).optional(),
  }),
});
export const companyRuntimeFileUploadBeginInputSchema = companyRuntimeIdentitySchema.extend({
  member_id: z.string().min(1),
  input: companyFileUploadBeginInputSchema,
});
export const companyRuntimeFileUploadFinalizeInputSchema = companyRuntimeIdentitySchema.extend({
  member_id: z.string().min(1),
  input: companyFileUploadFinalizeInputSchema,
});
export const companyRuntimeFileListResultSchema = companyFileListResultSchema;
export const companyRuntimeFileReadResultSchema = companyFileDownloadResultSchema;
export const companyRuntimeFileUploadResultSchema = companyFileSchema;

export const companyRuntimeAgentActivityInputSchema = companyRuntimeIdentitySchema.extend({
  event: roomCodexAgentRuntimeEnvelopeSchema,
});
export type CompanyRuntimeAgentActivityInput = z.infer<typeof companyRuntimeAgentActivityInputSchema>;

export const companyRuntimeAgentRoomInteractionRespondInputSchema = companyRuntimeIdentitySchema.extend({
  interaction_response: agentRoomInteractionResponseDispatchSchema,
});
export type CompanyRuntimeAgentRoomInteractionRespondInput = z.infer<typeof companyRuntimeAgentRoomInteractionRespondInputSchema>;

type MemberScoped<T> = T & { member_id: string };

const memberScopeShape = { member_id: z.string().min(1) };

export type CompanyRuntimeHomeThreadListInput = MemberScoped<HomeThreadListInput>;
export type CompanyRuntimeHomeProjectListInput = { member_id: string };
export type CompanyRuntimeHomeProjectCreateInput = MemberScoped<HomeProjectCreateInput>;
export type CompanyRuntimeHomeProjectUpdateInput = MemberScoped<HomeProjectUpdateInput>;
export type CompanyRuntimeHomeProjectDeleteInput = MemberScoped<HomeProjectDeleteInput>;
export type CompanyRuntimeHomeProjectThreadMoveInput = MemberScoped<HomeProjectThreadMoveInput>;
export type CompanyRuntimeHomeThreadDeleteInput = MemberScoped<HomeThreadDeleteInput>;
export type CompanyRuntimeHomeThreadForkInput = MemberScoped<HomeThreadForkInput>;
export type CompanyRuntimeHomeThreadSearchInput = MemberScoped<HomeThreadSearchInput>;
export type CompanyRuntimeHomeThreadReadInput = MemberScoped<HomeThreadReadInput>;
export type CompanyRuntimeHomeThreadSelectInput = MemberScoped<HomeThreadSelectInput>;
export type CompanyRuntimeHomeModelOptionsInput = { member_id: string };
export type CompanyRuntimeHomeThreadSettingsInput = MemberScoped<HomeThreadSettingsInput>;
export type CompanyRuntimeHomeThreadSettingsSetInput = MemberScoped<HomeThreadSettingsSetInput>;
export type CompanyRuntimeHomeConversationImportReadInput = MemberScoped<HomeConversationImportReadInput>;
export const companyRuntimeBuilderScopeSchema = z.strictObject({
  kind: z.enum(["agent", "asset"]),
  topic_id: z.string().min(1),
});
export type CompanyRuntimeBuilderScope = z.infer<typeof companyRuntimeBuilderScopeSchema>;
export type CompanyRuntimeHomeTurnSubmitInput = MemberScoped<HomeTurnSubmitInput> & {
  builder_scope?: CompanyRuntimeBuilderScope;
  developer_instructions?: string;
};
export type CompanyRuntimeHomeTurnEventsInput = MemberScoped<HomeTurnEventsInput>;
export type CompanyRuntimeHomeQuestionInteractionRespondInput = MemberScoped<HomeQuestionInteractionRespondInput>;
export type CompanyRuntimeHomeQuestionInteractionSnoozeInput = MemberScoped<HomeQuestionInteractionSnoozeInput>;
export type CompanyRuntimeHomeAllTurnEventsInput = { member_id: string };
export const companyRuntimeRoomSideChatTurnSubmitInputSchema = z.strictObject({
  member_id: z.string().min(1),
  room_id: z.string().min(1),
  thread_id: z.string().min(1).nullable().optional(),
  prompt: z.string().trim().min(1).max(40_000),
  client_message_id: z.string().min(1).optional(),
  timeout_ms: z.number().int().min(1_000).max(900_000).optional(),
  developer_instructions: z.string().max(40_000),
  model: z.string().min(1).optional(),
  reasoning_effort: z.string().min(1).nullable().optional(),
});
export type CompanyRuntimeRoomSideChatTurnSubmitInput = z.infer<
  typeof companyRuntimeRoomSideChatTurnSubmitInputSchema
>;
export const companyRuntimeRoomSideChatTurnEventsInputSchema = z.strictObject({
  member_id: z.string().min(1),
  room_id: z.string().min(1),
});
export type CompanyRuntimeRoomSideChatTurnEventsInput = z.infer<
  typeof companyRuntimeRoomSideChatTurnEventsInputSchema
>;
export const companyRuntimeRoomSideChatThreadReadInputSchema = z.strictObject({
  member_id: z.string().min(1),
  room_id: z.string().min(1),
  thread_id: z.string().min(1),
});
export type CompanyRuntimeRoomSideChatThreadReadInput = z.infer<
  typeof companyRuntimeRoomSideChatThreadReadInputSchema
>;
export type CompanyRuntimeHomeFilesystemSearchInput = MemberScoped<HomeFilesystemSearchInput>;
export type CompanyRuntimeHomeFilesystemListInput = MemberScoped<HomeFilesystemListInput>;
export type CompanyRuntimeHomeFilesystemCreateInput = MemberScoped<HomeFilesystemCreateInput>;
export type CompanyRuntimeHomeFilesystemRenameInput = MemberScoped<HomeFilesystemRenameInput>;
export type CompanyRuntimeHomeFilesystemDeleteInput = MemberScoped<HomeFilesystemDeleteInput>;
export type CompanyRuntimeHomeFilesystemEventsInput = MemberScoped<HomeFilesystemEventsInput>;

export const companyRuntimeHomeThreadListInputSchema:
z.ZodType<CompanyRuntimeHomeThreadListInput, CompanyRuntimeHomeThreadListInput> =
  homeThreadListInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeProjectListInputSchema:
z.ZodType<CompanyRuntimeHomeProjectListInput, CompanyRuntimeHomeProjectListInput> =
  homeProjectListInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeProjectCreateInputSchema:
z.ZodType<CompanyRuntimeHomeProjectCreateInput, CompanyRuntimeHomeProjectCreateInput> =
  homeProjectCreateInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeProjectUpdateInputSchema:
z.ZodType<CompanyRuntimeHomeProjectUpdateInput, CompanyRuntimeHomeProjectUpdateInput> =
  homeProjectUpdateInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeProjectDeleteInputSchema:
z.ZodType<CompanyRuntimeHomeProjectDeleteInput, CompanyRuntimeHomeProjectDeleteInput> =
  homeProjectDeleteInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeProjectThreadMoveInputSchema:
z.ZodType<CompanyRuntimeHomeProjectThreadMoveInput, CompanyRuntimeHomeProjectThreadMoveInput> =
  homeProjectThreadMoveInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeThreadDeleteInputSchema:
z.ZodType<CompanyRuntimeHomeThreadDeleteInput, CompanyRuntimeHomeThreadDeleteInput> =
  homeThreadDeleteInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeThreadForkInputSchema:
z.ZodType<CompanyRuntimeHomeThreadForkInput, CompanyRuntimeHomeThreadForkInput> =
  homeThreadForkInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeThreadSearchInputSchema:
z.ZodType<CompanyRuntimeHomeThreadSearchInput, CompanyRuntimeHomeThreadSearchInput> =
  homeThreadSearchInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeThreadReadInputSchema:
z.ZodType<CompanyRuntimeHomeThreadReadInput, CompanyRuntimeHomeThreadReadInput> =
  homeThreadReadInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeThreadSelectInputSchema:
z.ZodType<CompanyRuntimeHomeThreadSelectInput, CompanyRuntimeHomeThreadSelectInput> =
  homeThreadSelectInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeModelOptionsInputSchema:
z.ZodType<CompanyRuntimeHomeModelOptionsInput, CompanyRuntimeHomeModelOptionsInput> =
  homeModelOptionsInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeThreadSettingsInputSchema:
z.ZodType<CompanyRuntimeHomeThreadSettingsInput, CompanyRuntimeHomeThreadSettingsInput> =
  homeThreadSettingsInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeThreadSettingsSetInputSchema:
z.ZodType<CompanyRuntimeHomeThreadSettingsSetInput, CompanyRuntimeHomeThreadSettingsSetInput> =
  homeThreadSettingsSetInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeConversationImportReadInputSchema:
z.ZodType<CompanyRuntimeHomeConversationImportReadInput, CompanyRuntimeHomeConversationImportReadInput> =
  homeConversationImportReadInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeTurnSubmitInputSchema:
z.ZodType<CompanyRuntimeHomeTurnSubmitInput, CompanyRuntimeHomeTurnSubmitInput> =
  homeTurnSubmitInputSchema.extend({
    ...memberScopeShape,
    builder_scope: companyRuntimeBuilderScopeSchema.optional(),
    developer_instructions: z.string().max(40_000).optional(),
  });
export const companyRuntimeHomeTurnEventsInputSchema:
z.ZodType<CompanyRuntimeHomeTurnEventsInput, CompanyRuntimeHomeTurnEventsInput> =
  homeTurnEventsInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeQuestionInteractionRespondInputSchema:
z.ZodType<CompanyRuntimeHomeQuestionInteractionRespondInput, CompanyRuntimeHomeQuestionInteractionRespondInput> =
  homeQuestionInteractionRespondInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeQuestionInteractionSnoozeInputSchema:
z.ZodType<CompanyRuntimeHomeQuestionInteractionSnoozeInput, CompanyRuntimeHomeQuestionInteractionSnoozeInput> =
  homeQuestionInteractionSnoozeInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeAllTurnEventsInputSchema: z.ZodType<CompanyRuntimeHomeAllTurnEventsInput> = z.strictObject(memberScopeShape);
export const companyRuntimeHomeFilesystemSearchInputSchema:
z.ZodType<CompanyRuntimeHomeFilesystemSearchInput, CompanyRuntimeHomeFilesystemSearchInput> =
  homeFilesystemSearchInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeFilesystemListInputSchema:
z.ZodType<CompanyRuntimeHomeFilesystemListInput, CompanyRuntimeHomeFilesystemListInput> =
  homeFilesystemListInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeFilesystemCreateInputSchema:
z.ZodType<CompanyRuntimeHomeFilesystemCreateInput, CompanyRuntimeHomeFilesystemCreateInput> =
  homeFilesystemCreateInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeFilesystemRenameInputSchema:
z.ZodType<CompanyRuntimeHomeFilesystemRenameInput, CompanyRuntimeHomeFilesystemRenameInput> =
  homeFilesystemRenameInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeFilesystemDeleteInputSchema:
z.ZodType<CompanyRuntimeHomeFilesystemDeleteInput, CompanyRuntimeHomeFilesystemDeleteInput> =
  homeFilesystemDeleteInputSchema.extend(memberScopeShape);
export const companyRuntimeHomeFilesystemEventsInputSchema:
z.ZodType<CompanyRuntimeHomeFilesystemEventsInput, CompanyRuntimeHomeFilesystemEventsInput> =
  homeFilesystemEventsInputSchema.extend(memberScopeShape);
