/**
 * Provider-neutral invitation fact. Better Auth adapters translate their
 * invitation record into this deliberately small read model before it reaches
 * Actor Application policy.
 */
export type HumanInvitationAdmissionInvitation = {
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAtMs: number;
};

/** The only Company facts needed to admit an invited Human. */
export type ActiveInvitationCompany = {
  companyId: string;
  companyName: string;
};

/**
 * Company-owned read used by Human invitation admission. A null result means
 * the Organization currently has no single active Company mapping.
 */
export interface CompanyInvitationQuery {
  findActiveCompanyByAuthOrganizationId(organizationId: string): Promise<ActiveInvitationCompany | null>;
}

/**
 * Better Auth identity plus membership evidence for one normalized email and
 * one target Organization. It deliberately exposes neither credentials nor
 * any other user profile data.
 */
export type InvitationEmailAuthority = {
  authUserId: string;
  hasOrganizationMembership: boolean;
};

/**
 * Narrow Better Auth authority reads used by the Actor admission policy.
 * Implementations own the provider table access and must not return raw
 * provider payloads.
 */
export interface InvitationAuthorityQuery {
  findInvitationById(invitationId: string): Promise<HumanInvitationAdmissionInvitation | null>;
  hasAnyMembershipForAuthUser(authUserId: string): Promise<boolean>;
  findEmailAuthorities(input: {
    normalizedEmail: string;
    organizationId: string;
  }): Promise<readonly InvitationEmailAuthority[]>;
}

/** Minimal Actor projection evidence needed for re-invitation policy. */
export type InvitationHumanActor = {
  authUserId: string;
  status: "active" | "inactive";
};

/**
 * Actor-owned eligibility reads. The first check keeps removed Humans from
 * accepting another Company invitation; the batch read handles invitation
 * creation and sign-up for an email already projected into the target Company.
 */
export interface ActorInvitationHumanQuery {
  hasRetainedHumanForAuthUser(authUserId: string): Promise<boolean>;
  listInvitationHumans(input: {
    companyId: string;
    authUserIds: readonly string[];
  }): Promise<readonly InvitationHumanActor[]>;
}
