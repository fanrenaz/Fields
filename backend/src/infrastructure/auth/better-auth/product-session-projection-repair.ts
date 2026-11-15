import { eq } from "drizzle-orm";

import type { ProductSessionProjectionRepair } from "../../../application/actor/ports/index.js";
import type { BackendDatabase } from "../../persistence/postgres/database-service.js";
import {
  companies,
  member,
  user,
} from "../../persistence/postgres/schema/index.js";

export type HumanActorReconciliation = {
  execute(input: {
    authUserId: string;
    companyId: string;
    displayName: string;
    companyRole: "owner" | "member";
  }): Promise<unknown>;
};

/**
 * Re-reads Better Auth's committed membership before asking the Actor use
 * case to repair a Product projection. It cannot manufacture an authority
 * fact: mismatches are a quiet no-op and the Product Session query fails
 * closed on its mandatory reread.
 */
export class BetterAuthProductSessionProjectionRepair implements ProductSessionProjectionRepair {
  constructor(
    private readonly db: BackendDatabase,
    private readonly reconcileHumanActor: HumanActorReconciliation,
  ) {}

  async repair(input: { authUserId: string; activeOrganizationId: string }): Promise<void> {
    try {
      const [identity, memberships, mappedCompanies] = await Promise.all([
        this.db
          .select({ userId: user.id, displayName: user.name })
          .from(user)
          .where(eq(user.id, input.authUserId))
          .limit(2),
        this.db
          .select({ organizationId: member.organizationId, role: member.role })
          .from(member)
          .where(eq(member.userId, input.authUserId))
          .limit(2),
        this.db
          .select({ companyId: companies.id })
          .from(companies)
          .where(eq(companies.authOrganizationId, input.activeOrganizationId))
          .limit(2),
      ]);
      const currentIdentity = identity.length === 1 ? identity[0] : null;
      const currentMembership = memberships.length === 1 ? memberships[0] : null;
      const mappedCompany = mappedCompanies.length === 1 ? mappedCompanies[0] : null;
      if (
        !currentIdentity
        || !currentMembership
        || !mappedCompany
        || currentMembership.organizationId !== input.activeOrganizationId
        || !isCompanyRole(currentMembership.role)
      ) {
        return;
      }

      await this.reconcileHumanActor.execute({
        authUserId: input.authUserId,
        companyId: mappedCompany.companyId,
        displayName: currentIdentity.displayName,
        companyRole: currentMembership.role,
      });
    } catch {
      throw new BetterAuthProductSessionProjectionRepairError();
    }
  }
}

export class BetterAuthProductSessionProjectionRepairError extends Error {
  constructor() {
    super("The authenticated Product projection could not be repaired.");
    this.name = "BetterAuthProductSessionProjectionRepairError";
  }
}

function isCompanyRole(value: string): value is "owner" | "member" {
  return value === "owner" || value === "member";
}
