import type { Actor } from "../../../domain/actor/index.js";
import type { CompanyProductSessionQuery } from "../../company/queries/index.js";
import type {
  ActorQueryRepository,
  ProductSessionActor,
  ProductSessionMembershipAuthority,
  ProductSessionProjectionRepair,
  ProductSessionQuery,
} from "../ports/index.js";

export type ResolveProductSessionActorDependencies = {
  actors: ActorQueryRepository;
  companies: CompanyProductSessionQuery;
  memberships: ProductSessionMembershipAuthority;
  repair: ProductSessionProjectionRepair;
};

export class ResolveProductSessionActorQuery implements ProductSessionQuery {
  constructor(private readonly dependencies: ResolveProductSessionActorDependencies) {}

  async resolveVerifiedSession(input: {
    authUserId: string;
    activeOrganizationId: string | null;
  }): Promise<ProductSessionActor | null> {
    const initial = await this.read(input);
    if (initial !== "repair") return initial;
    if (input.activeOrganizationId === null) return null;
    try {
      await this.dependencies.repair.repair({
        authUserId: input.authUserId,
        activeOrganizationId: input.activeOrganizationId,
      });
      const repaired = await this.read(input);
      return repaired === "repair" ? null : repaired;
    } catch {
      return null;
    }
  }

  private async read(input: {
    authUserId: string;
    activeOrganizationId: string | null;
  }): Promise<ProductSessionActor | null | "repair"> {
    try {
      const human = await this.dependencies.actors.findByAuthUserId(input.authUserId);
      if (!human) return "repair";
      if (!isMatchingActiveHuman(human, input.authUserId)) return null;
      const company = await this.dependencies.companies.findForProductSession(human.companyId);
      if (!company || company.companyId !== human.companyId) return null;
      if (input.activeOrganizationId !== null) {
        if (company.authOrganizationId !== input.activeOrganizationId) return null;
      } else {
        const membership = await this.dependencies.memberships.resolveMembership({
          organizationId: company.authOrganizationId,
          userId: input.authUserId,
        });
        if (!membership || membership.role !== human.companyRole) return null;
      }
      return {
        actorId: human.id,
        companyId: human.companyId,
        companyRole: human.companyRole,
        displayName: human.displayName,
        actorType: "human",
        companyStatus: company.status,
      };
    } catch {
      return null;
    }
  }
}

function isMatchingActiveHuman(actor: Actor, authUserId: string): boolean {
  return actor.type === "human"
    && actor.status === "active"
    && actor.authUserId === authUserId;
}
