export type CompanyInvitationOrganization = {
  companyId: string;
  companyName: string;
  organizationId: string;
};

/** Company-owned mapping used to scope an invitation directory read. */
export interface CompanyInvitationOrganizationQuery {
  findActiveOrganizationByCompanyId(
    companyId: string,
  ): Promise<CompanyInvitationOrganization | null>;
}

export type PendingCompanyMemberInvitation = {
  invitationCredential: string;
  organizationId: string;
  email: string;
  role: string | null;
  providerStatus: string;
  createdAtMs: number;
  expiresAtMs: number;
};

/**
 * Better Auth-owned pending invitation facts. Implementations must filter to
 * the supplied Organization, the member role, and provider status pending.
 */
export interface PendingCompanyMemberInvitationQuery {
  listPendingMemberInvitations(
    organizationId: string,
  ): Promise<readonly PendingCompanyMemberInvitation[]>;
}
