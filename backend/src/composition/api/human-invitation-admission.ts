import { HumanInvitationAdmissionPolicy } from "../../application/actor/queries/human-invitation-admission.js";
import { BetterAuthInvitationAuthorityQuery } from "../../infrastructure/auth/better-auth/index.js";
import { SystemClock } from "../../infrastructure/configuration/index.js";
import {
  PostgresActorInvitationHumanQuery,
  PostgresCompanyInvitationQuery,
} from "../../infrastructure/persistence/postgres/repositories/index.js";
import type { BackendDatabase } from "../../infrastructure/persistence/postgres/database-service.js";

export type HumanInvitationAdmissionPolicyCompositionDependencies = {
  database: BackendDatabase;
};

/**
 * Composes the provider-neutral Human invitation admission policy before the
 * Better Auth instance is created. The policy only receives narrow authority
 * reads, so API composition can inject the same instance into Better Auth and
 * invitation preview without creating an auth/application cycle.
 */
export function createHumanInvitationAdmissionPolicy(
  dependencies: HumanInvitationAdmissionPolicyCompositionDependencies,
): HumanInvitationAdmissionPolicy {
  return new HumanInvitationAdmissionPolicy({
    invitations: new BetterAuthInvitationAuthorityQuery(dependencies.database),
    companies: new PostgresCompanyInvitationQuery(dependencies.database),
    humans: new PostgresActorInvitationHumanQuery(dependencies.database),
    clock: new SystemClock(),
  });
}
