import { z } from "zod";

export const companyActorTypeSchema = z.enum(["human", "agent"]);
export type CompanyActorType = z.infer<typeof companyActorTypeSchema>;

export const companyActorRoleSchema = z.enum(["owner", "member"]);
export type CompanyActorRole = z.infer<typeof companyActorRoleSchema>;

export const companyStatusSchema = z.enum(["provisioning", "active", "setup_failed"]);
export type CompanyStatus = z.infer<typeof companyStatusSchema>;

export const companyActorStatusSchema = z.enum(["active", "inactive"]);
export type CompanyActorStatus = z.infer<typeof companyActorStatusSchema>;

const companyActorDisplayNameSchema = z.string().trim().min(1).max(255);
const companyActorMarkSchema = z.string().trim().min(1).max(32);
const companyActorEmailSchema = z.string().trim().min(1).max(255).email();

export const companyActorSchema = z.object({
  actor_id: z.string().min(1),
  display_name: companyActorDisplayNameSchema,
  mark: companyActorMarkSchema,
  email: companyActorEmailSchema.nullable(),
  actor_type: companyActorTypeSchema,
  company_role: companyActorRoleSchema,
  status: companyActorStatusSchema,
}).strict().superRefine((actor, context) => {
  if (actor.actor_type === "human" && actor.email === null) {
    context.addIssue({
      code: "custom",
      message: "Human company actors must have an email address.",
      path: ["email"],
    });
  }
  if (actor.actor_type === "agent" && actor.email !== null) {
    context.addIssue({
      code: "custom",
      message: "Agent company actors cannot have an email address.",
      path: ["email"],
    });
  }
});
export type CompanyActor = z.infer<typeof companyActorSchema>;

export const companyActorsListResultSchema = z.object({
  items: z.array(companyActorSchema),
}).strict();
export type CompanyActorsListResult = z.infer<typeof companyActorsListResultSchema>;

export const companyActorsListInputSchema = z.void();
export type CompanyActorsListInput = z.infer<typeof companyActorsListInputSchema>;

export const companyInvitationStatusSchema = z.enum(["pending", "expired"]);
export type CompanyInvitationStatus = z.infer<typeof companyInvitationStatusSchema>;

export const companyInvitationSchema = z.strictObject({
  status: companyInvitationStatusSchema,
  invitation_credential: z.string().trim().min(1).max(512),
  email: companyActorEmailSchema,
  created_at_ms: z.number().int().nonnegative(),
  expires_at_ms: z.number().int().nonnegative(),
}).superRefine((invitation, context) => {
  if (invitation.expires_at_ms < invitation.created_at_ms) {
    context.addIssue({
      code: "custom",
      message: "Invitation expiry cannot precede creation.",
      path: ["expires_at_ms"],
    });
  }
});
export type CompanyInvitation = z.infer<typeof companyInvitationSchema>;

export const companyInvitationsListInputSchema = z.void();
export type CompanyInvitationsListInput = z.infer<typeof companyInvitationsListInputSchema>;

export const companyInvitationsListResultSchema = z.strictObject({
  items: z.array(companyInvitationSchema),
});
export type CompanyInvitationsListResult = z.infer<typeof companyInvitationsListResultSchema>;

export const companyActorGetInputSchema = z.object({
  actor_id: z.string().min(1),
}).strict();
export type CompanyActorGetInput = z.infer<typeof companyActorGetInputSchema>;

export const companyActorCreateInputSchema = z.object({
  actor_type: z.literal("agent"),
  display_name: companyActorDisplayNameSchema,
  mark: companyActorMarkSchema,
}).strict();
export type CompanyActorCreateInput = z.infer<typeof companyActorCreateInputSchema>;

export const companyActorCreateResultSchema = z.object({
  actor: companyActorSchema,
}).strict().superRefine((result, context) => {
  if (result.actor.actor_type !== "agent") {
    context.addIssue({
      code: "custom",
      message: "Company actor create only returns an Agent.",
      path: ["actor", "actor_type"],
    });
  }
});
export type CompanyActorCreateResult = z.infer<typeof companyActorCreateResultSchema>;

export const companyActorRemoveInputSchema = z.object({
  actor_id: z.string().min(1),
}).strict();
export type CompanyActorRemoveInput = z.infer<typeof companyActorRemoveInputSchema>;

export const companyActorRemoveResultSchema = z.object({
  actor_id: z.string().min(1),
  status: z.literal("inactive"),
}).strict();
export type CompanyActorRemoveResult = z.infer<typeof companyActorRemoveResultSchema>;

export const productSessionSchema = z.object({
  actor_id: z.string().min(1),
  company_id: z.string().min(1),
  display_name: companyActorDisplayNameSchema,
  actor_type: z.literal("human"),
  company_role: companyActorRoleSchema,
  company_status: companyStatusSchema,
}).strict();
export type ProductSession = z.infer<typeof productSessionSchema>;


export const companyOnboardingStageSchema = z.enum([
  "creatingRuntime",
  "initializingRuntime",
  "failed",
  "ready",
]);
export type CompanyOnboardingStage = z.infer<typeof companyOnboardingStageSchema>;

export const publicOperationErrorSchema = z.strictObject({
  code: z.string().min(1).max(128),
  retryable: z.boolean(),
});
export type PublicOperationError = z.infer<typeof publicOperationErrorSchema>;

export const sessionMeWithoutCompanySchema = z.strictObject({
  has_company: z.literal(false),
  registration_pending: z.boolean(),
  user_id: z.string().min(1),
  actor_id: z.null(),
  company_id: z.null(),
  display_name: z.string().trim().min(1).max(255),
  actor_type: z.literal("human"),
  company_role: z.null(),
  company_status: z.null(),
});

export const sessionMeWithCompanySchema = z.strictObject({
  has_company: z.literal(true),
  registration_pending: z.literal(false),
  user_id: z.string().min(1),
  actor_id: z.string().min(1),
  company_id: z.string().min(1),
  display_name: z.string().trim().min(1).max(255),
  actor_type: z.literal("human"),
  company_role: companyActorRoleSchema,
  company_status: companyStatusSchema,
});

export const sessionMeSchema = z.discriminatedUnion("has_company", [
  sessionMeWithoutCompanySchema,
  sessionMeWithCompanySchema,
]);
export type SessionMe = z.infer<typeof sessionMeSchema>;

const registrationCodeSchema = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/u);

export const registrationPrepareInputSchema = z.strictObject({
  email: companyActorEmailSchema,
  code: registrationCodeSchema,
});
export type RegistrationPrepareInput = z.infer<typeof registrationPrepareInputSchema>;

export const registrationPrepareResultSchema = z.strictObject({
  signup_credential: z.string().min(32).max(512),
  expires_at_ms: z.number().int().nonnegative(),
});
export type RegistrationPrepareResult = z.infer<typeof registrationPrepareResultSchema>;

export const registrationClaimResultSchema = z.strictObject({
  company_id: z.string().min(1),
  status: z.literal("joined"),
});
export type RegistrationClaimResult = z.infer<typeof registrationClaimResultSchema>;

export const companyRegistrationSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  code: registrationCodeSchema,
  code_version: z.number().int().positive(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type CompanyRegistrationSettings = z.infer<typeof companyRegistrationSettingsSchema>;

export const companyRegistrationSetEnabledInputSchema = z.strictObject({
  enabled: z.boolean(),
});
export type CompanyRegistrationSetEnabledInput = z.infer<typeof companyRegistrationSetEnabledInputSchema>;

export const companySummarySchema = z.strictObject({
  company_id: z.string().min(1),
  name: z.string().min(1).max(255),
  status: companyStatusSchema,
});
export type CompanySummary = z.infer<typeof companySummarySchema>;

export const companyRuntimeReadinessSchema = z.enum([
  "pending",
  "provisioning",
  "initializing",
  "ready",
  "degraded",
  "failed",
]);
export type CompanyRuntimeReadiness = z.infer<typeof companyRuntimeReadinessSchema>;

export const companyRuntimeSummarySchema = z.strictObject({
  status: companyRuntimeReadinessSchema,
  error: publicOperationErrorSchema.nullable(),
});
export type CompanyRuntimeSummary = z.infer<typeof companyRuntimeSummarySchema>;

export const companyRuntimeStatusInputSchema = z.void();
export type CompanyRuntimeStatusInput = z.infer<typeof companyRuntimeStatusInputSchema>;

export const companyRuntimeStatusResultSchema = z.strictObject({
  company_id: z.string().min(1),
  status: companyRuntimeReadinessSchema,
  member_app_servers: z.strictObject({
    running: z.number().int().nonnegative(),
    idle: z.number().int().nonnegative(),
    switching: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  active_execution_count: z.number().int().nonnegative(),
  last_seen_at_ms: z.number().int().nonnegative().nullable(),
  error: publicOperationErrorSchema.nullable(),
});
export type CompanyRuntimeStatusResult = z.infer<typeof companyRuntimeStatusResultSchema>;

export const companyRuntimeErrorCodeSchema = z.enum([
  "COMPANY_RUNTIME_NOT_PROVISIONED",
  "COMPANY_RUNTIME_UNAVAILABLE",
  "COMPANY_RUNTIME_LEASE_STALE",
  "FORBIDDEN",
]);
export type CompanyRuntimeErrorCode = z.infer<typeof companyRuntimeErrorCodeSchema>;

export const companyCreateInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
});
export type CompanyCreateInput = z.infer<typeof companyCreateInputSchema>;

export const companyCreateResultSchema = z.strictObject({
  company: companySummarySchema,
  runtime: companyRuntimeSummarySchema,
  operation_id: z.string().min(1),
});
export type CompanyCreateResult = z.infer<typeof companyCreateResultSchema>;

export const companyOnboardingStatusSchema = z.strictObject({
  stage: companyOnboardingStageSchema,
  company: companySummarySchema,
  runtime: companyRuntimeSummarySchema,
});
export type CompanyOnboardingStatus = z.infer<typeof companyOnboardingStatusSchema>;

export const companyOnboardingRetryResultSchema = companyOnboardingStatusSchema;
export type CompanyOnboardingRetryResult = z.infer<typeof companyOnboardingRetryResultSchema>;
