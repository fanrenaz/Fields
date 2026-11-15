import { eq } from "drizzle-orm";

import type {
  ReconcileHumanActorUseCase,
  ReconcileRemovedHumanUseCase,
} from "../../../application/actor/commands/index.js";
import {
  ApplicationError,
  isApplicationError,
} from "../../../application/platform/errors.js";
import type {
  CommittedMembershipActorProjection,
  CommittedMembershipProjectionInput,
} from "../../../application/actor/ports/index.js";
import type { BackendDatabase } from "../../persistence/postgres/database-service.js";
import {
  companies,
  member,
  user,
} from "../../persistence/postgres/schema/index.js";

export const COMMITTED_MEMBERSHIP_PROJECTION_INPUT_INVALID_CODE = "COMMITTED_MEMBERSHIP_PROJECTION_INPUT_INVALID";
export const COMMITTED_MEMBERSHIP_PROJECTION_CONFLICT_CODE = "COMMITTED_MEMBERSHIP_PROJECTION_CONFLICT";

type HumanIdentity = {
  authUserId: string;
  displayName: string;
};

type CurrentMembership = {
  organizationId: string;
  companyRole: "owner" | "member";
};

type MappedCompany = {
  companyId: string;
};

/**
 * Better Auth's committed-membership adapter. Its hook-shaped input contains
 * only opaque IDs; it rereads Better Auth tables and the Company mapping
 * before it invokes Actor Application use cases. It never queries or writes
 * the Actor table directly and never returns provider records to callers.
 */
export class BetterAuthCommittedMembershipProjection implements CommittedMembershipActorProjection {
  constructor(
    private readonly db: BackendDatabase,
    private readonly reconcileHumanActor: ReconcileHumanActorUseCase,
    private readonly reconcileRemovedHuman: ReconcileRemovedHumanUseCase,
  ) {}

  async reconcileAcceptedMembership(input: CommittedMembershipProjectionInput): Promise<void> {
    try {
      const authority = await this.readAcceptedAuthority(normalizedInput(input));
      if (authority === null) {
        return;
      }
      await this.reconcileHumanActor.execute(authority);
    } catch (error) {
      throw normalizeProjectionError(error);
    }
  }

  async reconcileRemovedMembership(input: CommittedMembershipProjectionInput): Promise<void> {
    try {
      const authority = await this.readRemovedAuthority(normalizedInput(input));
      if (authority === null) {
        return;
      }
      await this.reconcileRemovedHuman.execute(authority);
    } catch (error) {
      throw normalizeProjectionError(error);
    }
  }

  private async readAcceptedAuthority(input: CommittedMembershipProjectionInput): Promise<{
    authUserId: string;
    companyId: string;
    displayName: string;
    companyRole: "owner" | "member";
  } | null> {
    const [identities, memberships, mappedCompanies] = await Promise.all([
      this.db
        .select({ authUserId: user.id, displayName: user.name })
        .from(user)
        .where(eq(user.id, input.authUserId))
        .limit(2),
      this.db
        .select({ organizationId: member.organizationId, role: member.role })
        .from(member)
        .where(eq(member.userId, input.authUserId))
        .limit(2),
      this.db
        .select({ companyId: companies.id, organizationId: companies.authOrganizationId })
        .from(companies)
        .where(eq(companies.authOrganizationId, input.organizationId))
        .limit(2),
    ]);
    const identity = singleIdentity(identities, input.authUserId);
    const membership = singleCurrentMembership(memberships);
    const mappedCompany = singleMappedCompany(mappedCompanies, input.organizationId);
    if (identity === null || membership === null || mappedCompany === null) {
      return null;
    }
    if (membership.organizationId !== input.organizationId) {
      // A later removal/reassignment won the race after Better Auth accepted
      // the invitation; never recreate an obsolete active Actor projection.
      return null;
    }
    return {
      authUserId: identity.authUserId,
      companyId: mappedCompany.companyId,
      displayName: identity.displayName,
      companyRole: membership.companyRole,
    };
  }

  private async readRemovedAuthority(input: CommittedMembershipProjectionInput): Promise<{
    authUserId: string;
    companyId: string;
  } | null> {
    const [identities, memberships, mappedCompanies] = await Promise.all([
      this.db
        .select({ authUserId: user.id, displayName: user.name })
        .from(user)
        .where(eq(user.id, input.authUserId))
        .limit(2),
      this.db
        .select({ organizationId: member.organizationId, role: member.role })
        .from(member)
        .where(eq(member.userId, input.authUserId))
        .limit(2),
      this.db
        .select({ companyId: companies.id, organizationId: companies.authOrganizationId })
        .from(companies)
        .where(eq(companies.authOrganizationId, input.organizationId))
        .limit(2),
    ]);
    const identity = singleIdentity(identities, input.authUserId);
    const membership = singleRemovedMembership(memberships);
    const mappedCompany = singleMappedCompany(mappedCompanies, input.organizationId);
    if (identity === null || mappedCompany === null) {
      return null;
    }
    if (membership?.organizationId === input.organizationId) {
      // The authoritative row still exists, so this removal hook is stale or
      // observed before the committed delete becomes visible. Do no harm.
      return null;
    }
    return {
      authUserId: identity.authUserId,
      companyId: mappedCompany.companyId,
    };
  }
}

export class BetterAuthCommittedMembershipProjectionError extends Error {
  constructor() {
    super("The committed membership projection is temporarily unavailable.");
    this.name = "BetterAuthCommittedMembershipProjectionError";
  }
}

function normalizedInput(input: CommittedMembershipProjectionInput): CommittedMembershipProjectionInput {
  if (
    !isOpaqueAuthorityId(input.authUserId)
    || !isOpaqueAuthorityId(input.organizationId)
  ) {
    throw new ApplicationError(COMMITTED_MEMBERSHIP_PROJECTION_INPUT_INVALID_CODE, false);
  }
  return {
    authUserId: input.authUserId,
    organizationId: input.organizationId,
  };
}

function singleIdentity(
  rows: readonly { authUserId: string; displayName: string }[],
  expectedAuthUserId: string,
): HumanIdentity | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw conflict();
  }
  const row = rows[0];
  if (
    row.authUserId !== expectedAuthUserId
    || !isDisplayName(row.displayName)
  ) {
    throw conflict();
  }
  return {
    authUserId: row.authUserId,
    displayName: row.displayName.trim(),
  };
}

function singleCurrentMembership(
  rows: readonly { organizationId: string; role: string }[],
): CurrentMembership | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw conflict();
  }
  const row = rows[0];
  if (!isOpaqueAuthorityId(row.organizationId) || !isCompanyRole(row.role)) {
    throw conflict();
  }
  return {
    organizationId: row.organizationId,
    companyRole: row.role,
  };
}

function singleRemovedMembership(
  rows: readonly { organizationId: string; role: string }[],
): CurrentMembership | null {
  return singleCurrentMembership(rows);
}

function singleMappedCompany(
  rows: readonly { companyId: string; organizationId: string | null }[],
  expectedOrganizationId: string,
): MappedCompany | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw conflict();
  }
  const row = rows[0];
  if (
    !isProductIdentifier(row.companyId)
    || row.organizationId !== expectedOrganizationId
  ) {
    throw conflict();
  }
  return { companyId: row.companyId };
}

function normalizeProjectionError(error: unknown): Error {
  if (isApplicationError(error)) {
    return error;
  }
  return new BetterAuthCommittedMembershipProjectionError();
}

function conflict(): ApplicationError {
  return new ApplicationError(COMMITTED_MEMBERSHIP_PROJECTION_CONFLICT_CODE, false);
}

function isOpaqueAuthorityId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && value.trim() === value
    && !/[\r\n]/u.test(value);
}

function isProductIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && value.trim() === value
    && !/[\r\n]/u.test(value);
}

function isDisplayName(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.trim().length <= 255;
}

function isCompanyRole(value: string): value is "owner" | "member" {
  return value === "owner" || value === "member";
}
