import { and, eq } from "drizzle-orm";

import type { ProductSessionMembershipAuthority } from "../../../application/actor/ports/index.js";
import type { AuthOrganizationGateway } from "../../../application/company/ports/index.js";
import type { BackendDatabase } from "../../persistence/postgres/database-service.js";
import {
  companies,
  invitation,
  member,
  organization,
} from "../../persistence/postgres/schema/index.js";

export type BetterAuthOrganizationApi = {
  api: {
    createOrganization(input: {
      body: {
        name: string;
        slug: string;
        userId: string;
        keepCurrentActiveOrganization: boolean;
      };
    }): Promise<{ id?: unknown }>;
  };
};

/**
 * Isolates Better Auth's organization API and its compensation cleanup behind
 * the provider-neutral Company port. This is intentionally the sole caller
 * that chooses a Better Auth organization slug for Product creation.
 */
export class BetterAuthOrganizationGateway implements AuthOrganizationGateway, ProductSessionMembershipAuthority {
  constructor(
    private readonly auth: BetterAuthOrganizationApi,
    private readonly db: BackendDatabase,
    private readonly nextSlug: () => string,
  ) {}

  async createOrganization(input: {
    name: string;
    ownerUserId: string;
  }): Promise<{ organizationId: string }> {
    let slug: string | null = null;
    try {
      slug = requiredSlug(this.nextSlug());
      const created = await this.auth.api.createOrganization({
        body: {
          name: input.name,
          slug,
          userId: input.ownerUserId,
          keepCurrentActiveOrganization: true,
        },
      });
      if (typeof created.id !== "string" || !created.id.trim()) {
        throw new Error("Better Auth did not return an organization ID.");
      }
      return { organizationId: created.id };
    } catch {
      if (slug !== null) {
        await this.compensateUnmappedPartialOrganization(slug);
      }
      throw new BetterAuthOrganizationGatewayError();
    }
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    const normalizedOrganizationId = requiredOrganizationId(organizationId);
    try {
      const mappedCompanies = await this.db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.authOrganizationId, normalizedOrganizationId))
        .limit(2);
      if (mappedCompanies.length > 0) {
        throw new Error("Refusing to compensate a mapped organization.");
      }

      await this.db.transaction(async (transaction) => {
        await transaction.delete(invitation).where(eq(invitation.organizationId, normalizedOrganizationId));
        await transaction.delete(member).where(eq(member.organizationId, normalizedOrganizationId));
        await transaction.delete(organization).where(eq(organization.id, normalizedOrganizationId));
      });
    } catch {
      throw new BetterAuthOrganizationGatewayError();
    }
  }

  async resolveMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<{ role: "owner" | "member" } | null> {
    try {
      const memberships = await this.db
        .select({ role: member.role })
        .from(member)
        .where(and(
          eq(member.organizationId, requiredOrganizationId(input.organizationId)),
          eq(member.userId, requiredUserId(input.userId)),
        ))
        .limit(2);
      if (memberships.length !== 1) {
        return null;
      }
      const role = memberships[0]?.role;
      return role === "owner" || role === "member" ? { role } : null;
    } catch {
      throw new BetterAuthOrganizationGatewayError();
    }
  }

  /**
   * Better Auth can persist an Organization before a later Owner membership
   * insert fails. That API response contains no Organization ID, so recover
   * only the generated-slug row when it has neither a Product mapping nor a
   * member. A normal mapped Organization, or one with a committed member, is
   * never eligible for this best-effort cleanup.
   */
  private async compensateUnmappedPartialOrganization(slug: string): Promise<void> {
    try {
      const candidates = await this.db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, slug))
        .limit(2);
      if (candidates.length !== 1 || !candidates[0]?.id) {
        return;
      }
      const organizationId = candidates[0].id;
      await this.db.transaction(async (transaction) => {
        const current = await transaction
          .select({ id: organization.id })
          .from(organization)
          .where(and(eq(organization.id, organizationId), eq(organization.slug, slug)))
          .limit(2);
        if (current.length !== 1) {
          return;
        }
        const [mappedCompany] = await transaction
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.authOrganizationId, organizationId))
          .limit(1);
        const [existingMember] = await transaction
          .select({ id: member.id })
          .from(member)
          .where(eq(member.organizationId, organizationId))
          .limit(1);
        if (mappedCompany || existingMember) {
          return;
        }
        await transaction.delete(invitation).where(eq(invitation.organizationId, organizationId));
        await transaction.delete(member).where(eq(member.organizationId, organizationId));
        await transaction.delete(organization).where(and(
          eq(organization.id, organizationId),
          eq(organization.slug, slug),
        ));
      });
    } catch {
      // The original provider failure remains the only outward-safe result.
      // Cleanup is intentionally best effort and never deletes a mapped or
      // member-bearing Organization.
    }
  }
}

/** A cause-less port failure that is normalized by the Application process. */
export class BetterAuthOrganizationGatewayError extends Error {
  constructor() {
    super("The organization authority is temporarily unavailable.");
    this.name = "BetterAuthOrganizationGatewayError";
  }
}

function requiredSlug(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || /[\r\n]/u.test(normalized)) {
    throw new Error("An organization slug could not be generated.");
  }
  return normalized;
}

function requiredOrganizationId(value: string): string {
  if (!value || value.length > 512 || value.trim() !== value || /[\r\n]/u.test(value)) {
    throw new Error("An organization identifier is required.");
  }
  return value;
}

function requiredUserId(value: string): string {
  if (!value || value.length > 512 || value.trim() !== value || /[\r\n]/u.test(value)) {
    throw new Error("A user identifier is required.");
  }
  return value;
}
