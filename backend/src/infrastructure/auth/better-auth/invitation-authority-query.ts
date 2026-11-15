import { sql } from "drizzle-orm";

import type {
  HumanInvitationAdmissionInvitation,
  InvitationAuthorityQuery,
  InvitationEmailAuthority,
} from "../../../application/actor/ports/human-invitation-admission.js";
import type {
  PendingCompanyMemberInvitation,
  PendingCompanyMemberInvitationQuery,
} from "../../../application/actor/ports/company-invitation-directory.js";
import type { BackendDatabase } from "../../persistence/postgres/database-service.js";

type InvitationRow = {
  invitation_id: unknown;
  organization_id: unknown;
  email: unknown;
  role: unknown;
  status: unknown;
  expires_at: unknown;
};

type MembershipRow = {
  membership_id: unknown;
};

type EmailAuthorityRow = {
  auth_user_id: unknown;
  membership_id: unknown;
};

type PendingInvitationRow = {
  invitation_id: unknown;
  organization_id: unknown;
  email: unknown;
  role: unknown;
  status: unknown;
  created_at: unknown;
  expires_at: unknown;
};

/**
 * Better Auth-owned invitation authority reads. It deliberately exposes only
 * the invitation, membership, and email-match facts required by the Actor
 * admission policy; Company and Actor facts remain in their owners.
 */
export class BetterAuthInvitationAuthorityQuery implements
  InvitationAuthorityQuery,
  PendingCompanyMemberInvitationQuery {
  constructor(private readonly db: BackendDatabase) {}

  async findInvitationById(invitationId: string): Promise<HumanInvitationAdmissionInvitation | null> {
    try {
      if (!isAuthorityIdentifier(invitationId)) {
        throw unavailable();
      }
      const rows = rowsFromResult<InvitationRow>(await this.db.execute(sql`
        select
          id as invitation_id,
          organization_id,
          email,
          role,
          status,
          expires_at
        from invitation
        where id = ${invitationId}
        limit 2
      `));
      if (rows.length !== 1) {
        return null;
      }
      return invitationFromRow(rows[0], invitationId);
    } catch {
      throw unavailable();
    }
  }

  async hasAnyMembershipForAuthUser(authUserId: string): Promise<boolean> {
    try {
      if (!isAuthorityIdentifier(authUserId)) {
        throw unavailable();
      }
      const rows = rowsFromResult<MembershipRow>(await this.db.execute(sql`
        select id as membership_id
        from member
        where user_id = ${authUserId}
        limit 1
      `));
      if (rows.length === 0) {
        return false;
      }
      if (!isAuthorityIdentifier(rows[0]?.membership_id)) {
        throw unavailable();
      }
      return true;
    } catch {
      throw unavailable();
    }
  }

  async findEmailAuthorities(input: {
    normalizedEmail: string;
    organizationId: string;
  }): Promise<readonly InvitationEmailAuthority[]> {
    try {
      if (!isNormalizedEmail(input.normalizedEmail) || !isAuthorityIdentifier(input.organizationId)) {
        throw unavailable();
      }
      const rows = rowsFromResult<EmailAuthorityRow>(await this.db.execute(sql`
        select
          auth_user.id as auth_user_id,
          target_membership.id as membership_id
        from "user" auth_user
        left join member target_membership
          on target_membership.user_id = auth_user.id
          and target_membership.organization_id = ${input.organizationId}
        where lower(auth_user.email) = ${input.normalizedEmail}
        limit 2
      `));
      const authorities = rows.map(emailAuthorityFromRow);
      assertUniqueAuthorityIds(authorities);
      return Object.freeze(authorities);
    } catch {
      throw unavailable();
    }
  }

  async listPendingMemberInvitations(
    organizationId: string,
  ): Promise<readonly PendingCompanyMemberInvitation[]> {
    try {
      if (!isAuthorityIdentifier(organizationId)) {
        throw unavailable();
      }
      const rows = rowsFromResult<PendingInvitationRow>(await this.db.execute(sql`
        select
          id as invitation_id,
          organization_id,
          email,
          role,
          status,
          created_at,
          expires_at
        from invitation
        where organization_id = ${organizationId}
          and role = 'member'
          and status = 'pending'
        order by created_at asc, id asc
      `));
      const invitations = canonicalPendingInvitations(
        rows.map((row) => pendingInvitationFromRow(row, organizationId)),
      );
      assertUniqueInvitationCredentials(invitations);
      return Object.freeze(invitations);
    } catch {
      throw unavailable();
    }
  }
}

function canonicalPendingInvitations(
  invitations: readonly PendingCompanyMemberInvitation[],
): PendingCompanyMemberInvitation[] {
  const canonicalByEmail = new Map<string, PendingCompanyMemberInvitation>();
  for (const invitation of invitations) {
    const email = invitation.email.trim().toLowerCase();
    const current = canonicalByEmail.get(email);
    if (!current || comparePendingInvitationAuthority(invitation, current) < 0) {
      canonicalByEmail.set(email, invitation);
    }
  }
  return [...canonicalByEmail.values()].sort((left, right) => (
    left.createdAtMs - right.createdAtMs
    || left.invitationCredential.localeCompare(right.invitationCredential)
  ));
}

function comparePendingInvitationAuthority(
  left: PendingCompanyMemberInvitation,
  right: PendingCompanyMemberInvitation,
): number {
  if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
  return left.invitationCredential.localeCompare(right.invitationCredential);
}

function invitationFromRow(
  row: InvitationRow | undefined,
  expectedInvitationId: string,
): HumanInvitationAdmissionInvitation {
  const expiresAtMs = timestampMs(row?.expires_at);
  if (
    !row
    || !isAuthorityIdentifier(row.invitation_id)
    || row.invitation_id !== expectedInvitationId
    || !isAuthorityIdentifier(row.organization_id)
    || typeof row.email !== "string"
    || !isNullableString(row.role)
    || typeof row.status !== "string"
    || expiresAtMs === null
  ) {
    throw unavailable();
  }
  return {
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAtMs,
  };
}

function emailAuthorityFromRow(row: EmailAuthorityRow): InvitationEmailAuthority {
  if (
    !isAuthorityIdentifier(row.auth_user_id)
    || (row.membership_id !== null && !isAuthorityIdentifier(row.membership_id))
  ) {
    throw unavailable();
  }
  return {
    authUserId: row.auth_user_id,
    hasOrganizationMembership: row.membership_id !== null,
  };
}

function pendingInvitationFromRow(
  row: PendingInvitationRow,
  expectedOrganizationId: string,
): PendingCompanyMemberInvitation {
  const createdAtMs = timestampMs(row.created_at);
  const expiresAtMs = timestampMs(row.expires_at);
  if (
    !isAuthorityIdentifier(row.invitation_id)
    || row.organization_id !== expectedOrganizationId
    || typeof row.email !== "string"
    || row.role !== "member"
    || row.status !== "pending"
    || createdAtMs === null
    || expiresAtMs === null
  ) {
    throw unavailable();
  }
  return {
    invitationCredential: row.invitation_id,
    organizationId: expectedOrganizationId,
    email: row.email,
    role: row.role,
    providerStatus: row.status,
    createdAtMs,
    expiresAtMs,
  };
}

function assertUniqueAuthorityIds(authorities: readonly InvitationEmailAuthority[]): void {
  const ids = new Set<string>();
  for (const authority of authorities) {
    if (ids.has(authority.authUserId)) {
      throw unavailable();
    }
    ids.add(authority.authUserId);
  }
}

function assertUniqueInvitationCredentials(
  invitations: readonly PendingCompanyMemberInvitation[],
): void {
  const credentials = new Set<string>();
  for (const invitation of invitations) {
    if (credentials.has(invitation.invitationCredential)) {
      throw unavailable();
    }
    credentials.add(invitation.invitationCredential);
  }
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as T[];
    }
  }
  throw unavailable();
}

function isAuthorityIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && value.trim() === value
    && !/[\r\n]/u.test(value);
}

function isNormalizedEmail(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 255
    && value === value.trim().toLowerCase();
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function timestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 128
    || value.trim() !== value
    || /[\r\n]/u.test(value)
  ) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function unavailable(): Error {
  return new Error("Invitation authority is temporarily unavailable.");
}
