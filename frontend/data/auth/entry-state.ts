import type {
  CompanyOnboardingStage,
  ProductSession,
  SessionMe,
} from "@fields/contracts/public/company";

export const ONBOARDING_POLL_INTERVAL_MS = 1_000;

export type AuthenticatedEntry = "noAccess" | "registrationPending" | "onboarding" | "workspace";

export function authenticatedEntryFor(session: SessionMe): AuthenticatedEntry {
  if (!session.has_company) return session.registration_pending ? "registrationPending" : "noAccess";
  return session.company_status === "active" ? "workspace" : "onboarding";
}

export function shouldMountProductWorkspace(session: SessionMe): boolean {
  return authenticatedEntryFor(session) === "workspace";
}

export function onboardingUsesGlobalLoading(stage: CompanyOnboardingStage): boolean {
  return stage === "creatingRuntime" || stage === "initializingRuntime";
}

export function activeProductSessionFrom(session: SessionMe): ProductSession | null {
  if (!session.has_company || session.company_status !== "active") return null;
  return {
    actor_id: session.actor_id,
    company_id: session.company_id,
    display_name: session.display_name,
    actor_type: "human",
    company_role: session.company_role,
    company_status: session.company_status,
  };
}
