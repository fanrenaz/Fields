import type { CompanyInvitation } from "@fields/contracts/public/company";

import { ApplicationError } from "../../platform/errors.js";
import type {
  CompanyInvitationOrganizationQuery,
  PendingCompanyMemberInvitation,
  PendingCompanyMemberInvitationQuery,
} from "../ports/company-invitation-directory.js";
import type { RequireActiveHumanCompanyOwnerUseCase } from "./require-active-company-owner.js";

export const COMPANY_INVITATIONS_UNAVAILABLE_CODE = "COMPANY_INVITATIONS_UNAVAILABLE";

export type ListCompanyInvitationsDependencies = {
  ownerAuthorization: RequireActiveHumanCompanyOwnerUseCase;
  companies: CompanyInvitationOrganizationQuery;
  invitations: PendingCompanyMemberInvitationQuery;
  now: () => number;
};

export interface ListCompanyInvitationsUseCase {
  execute(input: {
    companyId: string;
    requestedByActorId: string;
  }): Promise<readonly CompanyInvitation[]>;
}

/** Owner-only Company invitation projection with server-derived expiry state. */
export class ListCompanyInvitations implements ListCompanyInvitationsUseCase {
  constructor(private readonly dependencies: ListCompanyInvitationsDependencies) {}

  async execute(input: {
    companyId: string;
    requestedByActorId: string;
  }): Promise<readonly CompanyInvitation[]> {
    await this.dependencies.ownerAuthorization.execute(input);
    try {
      const company = await this.dependencies.companies.findActiveOrganizationByCompanyId(
        input.companyId,
      );
      if (company === null || company.companyId !== input.companyId) {
        throw unavailable();
      }
      const nowMs = this.dependencies.now();
      if (!isTimestamp(nowMs)) {
        throw unavailable();
      }
      const invitations = await this.dependencies.invitations.listPendingMemberInvitations(
        company.organizationId,
      );
      return Object.freeze(invitations.map((invitation) => projectInvitation(
        invitation,
        company.organizationId,
        nowMs,
      )));
    } catch {
      throw unavailable();
    }
  }
}

function projectInvitation(
  invitation: PendingCompanyMemberInvitation,
  organizationId: string,
  nowMs: number,
): CompanyInvitation {
  if (
    invitation.organizationId !== organizationId
    || invitation.role !== "member"
    || invitation.providerStatus !== "pending"
    || !isIdentifier(invitation.invitationCredential)
    || !isEmail(invitation.email)
    || !isTimestamp(invitation.createdAtMs)
    || !isTimestamp(invitation.expiresAtMs)
    || invitation.expiresAtMs < invitation.createdAtMs
  ) {
    throw unavailable();
  }
  return {
    status: invitation.expiresAtMs <= nowMs ? "expired" : "pending",
    invitation_credential: invitation.invitationCredential,
    email: invitation.email,
    created_at_ms: invitation.createdAtMs,
    expires_at_ms: invitation.expiresAtMs,
  };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && value.trim() === value
    && !/[\r\n]/u.test(value);
}

function isEmail(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 255
    && value.trim() === value
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function unavailable(): ApplicationError {
  return new ApplicationError(COMPANY_INVITATIONS_UNAVAILABLE_CODE, true);
}
