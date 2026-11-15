import { z } from "zod";

export const executorScopeSchema = z.literal("personal");
export type ExecutorScope = z.infer<typeof executorScopeSchema>;

export const personalExecutorSharingStatusSchema = z.enum([
  "private",
  "company_shared",
  "admin_blocked",
]);
export type PersonalExecutorSharingStatus = z.infer<typeof personalExecutorSharingStatusSchema>;

export const executorAvailabilitySchema = z.enum([
  "available",
  "pending_auth",
  "configuration_required",
  "unavailable",
  "disconnected",
]);
export type ExecutorAvailability = z.infer<typeof executorAvailabilitySchema>;

export const executorAuthorizationMethodSchema = z.enum([
  "chatgpt",
  "custom_api_key",
]);
export type ExecutorAuthorizationMethod = z.infer<typeof executorAuthorizationMethodSchema>;

export const executorTypeSchema = z.enum(["codex", "claude_code", "openclaw"]);
export type ExecutorType = z.infer<typeof executorTypeSchema>;

export const executorBindingMethodSchema = z.enum(["device_code", "api_key"]);
export type ExecutorBindingMethod = z.infer<typeof executorBindingMethodSchema>;

export const executorConfigurationStatusSchema = z.enum([
  "pending",
  "validating",
  "ready",
  "invalid",
]);
export type ExecutorConfigurationStatus = z.infer<typeof executorConfigurationStatusSchema>;

export const executorModelSourceSchema = z.enum(["catalog", "manual"]);
export type ExecutorModelSource = z.infer<typeof executorModelSourceSchema>;

export const executorModelValidationStatusSchema = z.enum([
  "unvalidated",
  "validating",
  "available",
  "unavailable",
]);
export type ExecutorModelValidationStatus = z.infer<typeof executorModelValidationStatusSchema>;

export const executorModelPolicyItemSchema = z.strictObject({
  model: z.string().trim().min(1).max(512),
  display_name: z.string().trim().min(1).max(512),
  source: executorModelSourceSchema,
  supported_reasoning_efforts: z.array(z.string().trim().min(1).max(64)),
  validation_status: executorModelValidationStatusSchema,
  last_validated_at_ms: z.number().int().nonnegative().nullable(),
});
export type ExecutorModelPolicyItem = z.infer<typeof executorModelPolicyItemSchema>;

export const executorModelPolicySchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  status: executorConfigurationStatusSchema,
  models: z.array(executorModelPolicyItemSchema),
  allowed_reasoning_efforts: z.array(z.string().trim().min(1).max(64)),
  default_model: z.string().trim().min(1).max(512).nullable(),
  default_reasoning_effort: z.string().trim().min(1).max(64).nullable(),
  catalog_checked_at_ms: z.number().int().nonnegative().nullable(),
  updated_at_ms: z.number().int().nonnegative().nullable(),
}).superRefine((policy, context) => {
  if (policy.status === "ready") {
    if (policy.models.length === 0 || policy.default_model === null) {
      context.addIssue({ code: "custom", message: "A ready Executor policy requires models and a default model." });
      return;
    }
    const defaultModel = policy.models.find((item) => item.model === policy.default_model);
    if (!defaultModel || defaultModel.validation_status !== "available") {
      context.addIssue({ code: "custom", path: ["default_model"], message: "The default model must be available." });
    }
    if (policy.default_reasoning_effort !== null) {
      const defaultEffort = policy.default_reasoning_effort;
      if (!policy.allowed_reasoning_efforts.includes(defaultEffort)) {
        context.addIssue({ code: "custom", path: ["default_reasoning_effort"], message: "The default reasoning effort must be allowed." });
      }
      if (policy.models.some((item) => !item.supported_reasoning_efforts.includes(defaultEffort))) {
        context.addIssue({ code: "custom", path: ["default_reasoning_effort"], message: "The default reasoning effort must be supported by every model." });
      }
    }
  }
});
export type ExecutorModelPolicy = z.infer<typeof executorModelPolicySchema>;

export const companyProxyProtocolSchema = z.enum(["http", "https", "socks5"]);
export type CompanyProxyProtocol = z.infer<typeof companyProxyProtocolSchema>;

export const companyProxyStatusSchema = z.strictObject({
  enabled: z.boolean(),
  protocol: companyProxyProtocolSchema.nullable(),
  endpoint_host: z.string().trim().min(1).max(253).nullable(),
  endpoint_port: z.number().int().min(1).max(65_535).nullable(),
  authentication: z.enum(["none", "username_password"]).nullable(),
  revision: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative().nullable(),
});
export type CompanyProxyStatus = z.infer<typeof companyProxyStatusSchema>;

export const companyProxySetInputSchema = z.strictObject({
  protocol: companyProxyProtocolSchema,
  endpoint_host: z.string().trim().min(1).max(253).refine(
    (value) => /^[A-Za-z0-9._:-]+$/u.test(value),
    { message: "endpoint_host contains unsupported characters" },
  ),
  endpoint_port: z.number().int().min(1).max(65_535),
  credentials: z.strictObject({
    username: z.string().min(1).max(512),
    password: z.string().min(1).max(4096),
  }).nullable(),
  expected_revision: z.number().int().nonnegative(),
});
export type CompanyProxySetInput = z.infer<typeof companyProxySetInputSchema>;

export const companyProxyDisableInputSchema = z.strictObject({
  expected_revision: z.number().int().nonnegative(),
});
export type CompanyProxyDisableInput = z.infer<typeof companyProxyDisableInputSchema>;

export const executorAuthorizationSafeSummarySchema = z.discriminatedUnion("method", [
  z.strictObject({
    method: z.literal("chatgpt"),
    plan_type: z.string().min(1).max(128).nullable(),
  }),
  z.strictObject({
    method: z.literal("custom_api_key"),
  }),
]);
export type ExecutorAuthorizationSafeSummary = z.infer<typeof executorAuthorizationSafeSummarySchema>;

export const personalExecutorAuthorizationSummarySchema = z.discriminatedUnion("method", [
  z.strictObject({
    method: z.literal("chatgpt"),
    account_id: z.string().min(1).max(255).nullable(),
    plan_type: z.string().min(1).max(128).nullable(),
  }),
  z.strictObject({
    method: z.literal("custom_api_key"),
    endpoint_host: z.string().trim().min(1).max(512).nullable(),
  }),
]);
export type PersonalExecutorAuthorizationSummary = z.infer<typeof personalExecutorAuthorizationSummarySchema>;

/**
 * Browser-safe Executor identity. Provider credentials and account identity
 * are intentionally absent.
 */
export const executorSafeSummarySchema = z.strictObject({
  executor_id: z.string().min(1),
  scope: executorScopeSchema,
  executor_type: executorTypeSchema,
  binding_method: executorBindingMethodSchema,
  owner_actor_id: z.string().min(1),
  owner_display_name: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  authorization: executorAuthorizationSafeSummarySchema,
  availability: executorAvailabilitySchema,
  model_policy: executorModelPolicySchema,
});
export type ExecutorSafeSummary = z.infer<typeof executorSafeSummarySchema>;

/** Company Owner governance projection; account identity remains owner-private. */
export const companySharedPoolExecutorSummarySchema = executorSafeSummarySchema.extend({
  sharing_status: z.enum(["company_shared", "admin_blocked"]),
});
export type CompanySharedPoolExecutorSummary = z.infer<typeof companySharedPoolExecutorSummarySchema>;

/** Owner-only credential authority projection. */
export const personalExecutorSummarySchema = executorSafeSummarySchema.extend({
  authorization: personalExecutorAuthorizationSummarySchema,
  sharing_status: personalExecutorSharingStatusSchema,
  credential_version: z.number().int().nonnegative(),
  connected_at_ms: z.number().int().nonnegative().nullable(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type PersonalExecutorSummary = z.infer<typeof personalExecutorSummarySchema>;

export const personalExecutorsListResultSchema = z.strictObject({
  items: z.array(personalExecutorSummarySchema),
});
export type PersonalExecutorsListResult = z.infer<typeof personalExecutorsListResultSchema>;

export const personalExecutorCreateInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  executor_type: z.literal("codex").default("codex"),
  authorization_method: executorAuthorizationMethodSchema,
});
export type PersonalExecutorCreateInput = z.infer<typeof personalExecutorCreateInputSchema>;

export const personalExecutorMutationInputSchema = z.strictObject({
  executor_id: z.string().min(1),
});
export type PersonalExecutorMutationInput = z.infer<typeof personalExecutorMutationInputSchema>;

export const personalExecutorRenameInputSchema = personalExecutorMutationInputSchema.extend({
  name: z.string().trim().min(1).max(255),
});
export type PersonalExecutorRenameInput = z.infer<typeof personalExecutorRenameInputSchema>;

export const personalExecutorMutationResultSchema = z.strictObject({
  executor: personalExecutorSummarySchema,
});
export type PersonalExecutorMutationResult = z.infer<typeof personalExecutorMutationResultSchema>;

export const executorDeviceAuthorizationStartResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  attempt_id: z.string().min(1),
  verification_url: z.string().url(),
  user_code: z.string().min(1),
});
export type ExecutorDeviceAuthorizationStartResult = z.infer<typeof executorDeviceAuthorizationStartResultSchema>;

export const executorDeviceAuthorizationStatusInputSchema = personalExecutorMutationInputSchema.extend({
  attempt_id: z.string().min(1),
});
export type ExecutorDeviceAuthorizationStatusInput = z.infer<typeof executorDeviceAuthorizationStatusInputSchema>;

export const executorAuthorizationRuntimeUnavailableCode = "EXECUTOR_AUTHORIZATION_RUNTIME_UNAVAILABLE";

export const executorDeviceAuthorizationStatusSchema = z.enum([
  "pending",
  "completed",
  "cancelled",
  "failed",
]);

export const executorDeviceAuthorizationStatusResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  attempt_id: z.string().min(1),
  status: executorDeviceAuthorizationStatusSchema,
  error_code: z.string().min(1).max(128).nullable(),
  retryable: z.boolean(),
});
export type ExecutorDeviceAuthorizationStatusResult = z.infer<typeof executorDeviceAuthorizationStatusResultSchema>;

export const executorDeviceAuthorizationCancelResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  attempt_id: z.string().min(1),
  status: z.literal("cancelled"),
});
export type ExecutorDeviceAuthorizationCancelResult = z.infer<typeof executorDeviceAuthorizationCancelResultSchema>;

export const executorCustomApiConfigureInputSchema = personalExecutorMutationInputSchema.extend({
  base_url: z.string().trim().min(1).max(2048).refine(isHttpsUrlWithoutCredentials, {
    message: "base_url must be an HTTPS URL without embedded credentials",
  }),
  api_key: z.string().min(1).max(8192).refine((value) => value.trim().length > 0, {
    message: "api_key must not be blank",
  }),
});
export type ExecutorCustomApiConfigureInput = z.infer<typeof executorCustomApiConfigureInputSchema>;

export const executorModelCatalogInputSchema = personalExecutorMutationInputSchema;
export type ExecutorModelCatalogInput = z.infer<typeof executorModelCatalogInputSchema>;

export const executorModelCatalogResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  items: z.array(executorModelPolicyItemSchema),
  catalog_state: z.enum(["live", "unavailable"]),
  checked_at_ms: z.number().int().nonnegative(),
});
export type ExecutorModelCatalogResult = z.infer<typeof executorModelCatalogResultSchema>;

export const executorModelValidationInputSchema = personalExecutorMutationInputSchema.extend({
  models: z.array(z.strictObject({
    model: z.string().trim().min(1).max(512),
    display_name: z.string().trim().min(1).max(512),
    source: executorModelSourceSchema,
    supported_reasoning_efforts: z.array(z.string().trim().min(1).max(64)),
  })).min(1),
});
export type ExecutorModelValidationInput = z.infer<typeof executorModelValidationInputSchema>;

export const executorModelValidationResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  items: z.array(executorModelPolicyItemSchema),
});
export type ExecutorModelValidationResult = z.infer<typeof executorModelValidationResultSchema>;

export const executorModelPolicyUpdateInputSchema = personalExecutorMutationInputSchema.extend({
  expected_revision: z.number().int().nonnegative(),
  models: z.array(executorModelPolicyItemSchema).min(1),
  allowed_reasoning_efforts: z.array(z.string().trim().min(1).max(64)),
  default_model: z.string().trim().min(1).max(512),
  default_reasoning_effort: z.string().trim().min(1).max(64).nullable(),
}).superRefine((policy, context) => {
  if (new Set(policy.models.map((item) => item.model)).size !== policy.models.length) {
    context.addIssue({ code: "custom", path: ["models"], message: "Selected models must be unique." });
  }
  if (policy.models.some((item) => item.validation_status !== "available")) {
    context.addIssue({ code: "custom", path: ["models"], message: "Every selected model must be validated and available." });
  }
  const defaultModel = policy.models.find((item) => item.model === policy.default_model);
  if (!defaultModel) {
    context.addIssue({ code: "custom", path: ["default_model"], message: "The default model must be selected." });
  }
  for (const effort of policy.allowed_reasoning_efforts) {
    if (!policy.models.some((item) => item.supported_reasoning_efforts.includes(effort))) {
      context.addIssue({ code: "custom", path: ["allowed_reasoning_efforts"], message: "Allowed reasoning efforts must be supported by a selected model." });
    }
  }
  if (policy.default_reasoning_effort !== null && (
    !policy.allowed_reasoning_efforts.includes(policy.default_reasoning_effort)
    || policy.models.some((item) => !item.supported_reasoning_efforts.includes(policy.default_reasoning_effort!))
  )) {
    context.addIssue({ code: "custom", path: ["default_reasoning_effort"], message: "The default reasoning effort must be allowed and supported by every selected model." });
  }
});
export type ExecutorModelPolicyUpdateInput = z.infer<typeof executorModelPolicyUpdateInputSchema>;

export const executorModelPolicyResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  policy: executorModelPolicySchema,
});
export type ExecutorModelPolicyResult = z.infer<typeof executorModelPolicyResultSchema>;

function isHttpsUrlWithoutCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const executorUsageTargetSchema = z.strictObject({
  type: z.literal("member"),
  member_id: z.string().min(1),
  member_name: z.string().trim().min(1).max(255),
  member_type: z.enum(["human", "agent"]),
});
export type ExecutorUsageTarget = z.infer<typeof executorUsageTargetSchema>;

export const personalExecutorUsageResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  items: z.array(executorUsageTargetSchema),
});
export type PersonalExecutorUsageResult = z.infer<typeof personalExecutorUsageResultSchema>;

export const executorDeleteResultSchema = z.strictObject({
  executor_id: z.string().min(1),
  deleted: z.literal(true),
});
export type ExecutorDeleteResult = z.infer<typeof executorDeleteResultSchema>;

export const companyExecutorSafeListResultSchema = z.strictObject({
  items: z.array(companySharedPoolExecutorSummarySchema),
});
export type CompanyExecutorSafeListResult = z.infer<typeof companyExecutorSafeListResultSchema>;

export const companyExecutorSharingGovernanceInputSchema = z.strictObject({
  executor_id: z.string().min(1),
});
export type CompanyExecutorSharingGovernanceInput = z.infer<typeof companyExecutorSharingGovernanceInputSchema>;

export const companyExecutorSharingGovernanceResultSchema = z.strictObject({
  executor: executorSafeSummarySchema,
  sharing_status: personalExecutorSharingStatusSchema,
});
export type CompanyExecutorSharingGovernanceResult = z.infer<typeof companyExecutorSharingGovernanceResultSchema>;

export const memberExecutorSessionStateSchema = z.enum([
  "unconfigured",
  "configuration_required",
  "preparing",
  "ready",
  "switching",
  "auth_required",
  "failed",
  "stopped",
]);
export type MemberExecutorSessionState = z.infer<typeof memberExecutorSessionStateSchema>;

export const memberExecutorAssignmentSchema = z.strictObject({
  member_id: z.string().min(1),
  executor: executorSafeSummarySchema.nullable(),
  version: z.number().int().nonnegative(),
  session_state: memberExecutorSessionStateSchema,
  updated_at_ms: z.number().int().nonnegative(),
}).superRefine((assignment, context) => {
  if (assignment.executor === null
    && !["unconfigured", "configuration_required", "auth_required", "failed", "stopped"].includes(assignment.session_state)) {
    context.addIssue({
      code: "custom",
      path: ["session_state"],
      message: "An unbound Member cannot have an active Executor session state.",
    });
  }
});
export type MemberExecutorAssignment = z.infer<typeof memberExecutorAssignmentSchema>;

export const memberExecutorCurrentInputSchema = z.void();
export type MemberExecutorCurrentInput = z.infer<typeof memberExecutorCurrentInputSchema>;

export const memberExecutorSetInputSchema = z.strictObject({
  executor_id: z.string().min(1),
});
export type MemberExecutorSetInput = z.infer<typeof memberExecutorSetInputSchema>;

export const companyMemberExecutorInputSchema = z.strictObject({
  member_id: z.string().min(1),
});
export type CompanyMemberExecutorInput = z.infer<typeof companyMemberExecutorInputSchema>;

export const companyMemberExecutorSetInputSchema = companyMemberExecutorInputSchema.extend({
  executor_id: z.string().min(1),
});
export type CompanyMemberExecutorSetInput = z.infer<typeof companyMemberExecutorSetInputSchema>;

export const memberExecutorOptionsResultSchema = z.strictObject({
  member_id: z.string().min(1),
  items: z.array(executorSafeSummarySchema),
});
export type MemberExecutorOptionsResult = z.infer<typeof memberExecutorOptionsResultSchema>;

export const memberExecutorErrorCodeSchema = z.enum([
  "MEMBER_NOT_FOUND",
  "AGENT_MEMBER_REQUIRED",
  "MEMBER_EXECUTOR_NOT_CONFIGURED",
  "EXECUTOR_NOT_FOUND",
  "EXECUTOR_NOT_AVAILABLE",
  "EXECUTOR_NOT_ALLOWED",
  "EXECUTOR_MODEL_NOT_ALLOWED",
  "EXECUTOR_REASONING_EFFORT_NOT_ALLOWED",
  "EXECUTOR_THREAD_MODEL_SELECTION_REQUIRED",
  "MEMBER_EXECUTOR_SWITCH_IN_PROGRESS",
  "MEMBER_EXECUTOR_DRAIN_FAILED",
  "MEMBER_EXECUTOR_RESUME_FAILED",
  "FORBIDDEN",
]);
export type MemberExecutorErrorCode = z.infer<typeof memberExecutorErrorCodeSchema>;
