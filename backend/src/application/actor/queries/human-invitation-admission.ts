import type { Clock } from "../../platform/ports/index.js";
import type {
  ActiveInvitationCompany,
  ActorInvitationHumanQuery,
  CompanyInvitationQuery,
  HumanInvitationAdmissionInvitation,
  InvitationAuthorityQuery,
  InvitationEmailAuthority,
  InvitationHumanActor,
} from "../ports/index.js";

export const HUMAN_INVITATION_ADMISSION_INVALID_CODE = "FIELDS_INVITATION_INVALID";
export const HUMAN_INVITATION_ADMISSION_ROLE_INVALID_CODE = "FIELDS_INVITATION_ROLE_INVALID";
export const HUMAN_INVITATION_ADMISSION_SECOND_COMPANY_CODE = "FIELDS_SECOND_COMPANY_FORBIDDEN";
export const HUMAN_INVITATION_ADMISSION_REMOVED_HUMAN_CODE = "FIELDS_REMOVED_HUMAN_REINVITE_FORBIDDEN";
export const HUMAN_INVITATION_ADMISSION_EXISTING_HUMAN_CODE = "FIELDS_EXISTING_HUMAN_INVITE_FORBIDDEN";
export const HUMAN_INVITATION_ADMISSION_UNAVAILABLE_CODE = "FIELDS_INVITATION_POLICY_UNAVAILABLE";

export type HumanInvitationAdmissionFailure =
  | "invalid"
  | "role-invalid"
  | "second-company"
  | "removed-human"
  | "existing-human"
  | "unavailable";

export type HumanInvitationPreview = {
  company_name: string;
};

export type HumanInvitationAdmissionPolicyDependencies = {
  invitations: InvitationAuthorityQuery;
  companies: CompanyInvitationQuery;
  humans: ActorInvitationHumanQuery;
  clock: Clock;
};

/**
 * Provider-neutral dependency-injection surface for Better Auth hooks and the
 * public invitation-preview adapter. Neither caller needs the concrete Actor
 * policy class or a persistence dependency.
 */
export interface HumanInvitationAdmissionPolicyUseCase {
  assertEmailSignUpAllowed(input: {
    invitationId: string | null;
    email: unknown;
    name: unknown;
  }): Promise<void>;
  previewInvitation(invitationId: string | null): Promise<HumanInvitationPreview>;
  assertInvitationCreationAllowed(input: {
    organizationId: string;
    email: string;
    role: string;
  }): Promise<void>;
  assertInvitationAcceptanceAllowed(input: {
    invitation: HumanInvitationAdmissionInvitation;
    userId: string;
    userEmail: string;
  }): Promise<void>;
  assertMappedOrganization(organizationId: string): Promise<void>;
}

/**
 * Provider-neutral Human admission policy for Better Auth invitation hooks and
 * the public invitation preview. The adapters supply authority facts; this
 * class owns only the existing Fields eligibility decisions and safe outcomes.
 */
export class HumanInvitationAdmissionPolicy implements HumanInvitationAdmissionPolicyUseCase {
  constructor(private readonly dependencies: HumanInvitationAdmissionPolicyDependencies) {}

  async assertEmailSignUpAllowed(input: {
    invitationId: string | null;
    email: unknown;
    name: unknown;
  }): Promise<void> {
    return this.run(async () => {
      const invitationId = normalizedInvitationId(input.invitationId);
      const email = normalizedEmail(input.email);
      normalizedDisplayName(input.name);
      const invitation = await this.requireInvitation(invitationId);
      this.assertPendingMemberInvitation(invitation);
      assertInvitationEmailMatches(invitation, email);
      const company = await this.requireCurrentCompany(invitation.organizationId);
      await this.rejectPreviouslyProjectedHuman(company.companyId, invitation.organizationId, email);
    });
  }

  async previewInvitation(invitationId: string | null): Promise<HumanInvitationPreview> {
    return this.run(async () => {
      const invitation = await this.requireInvitation(normalizedInvitationId(invitationId));
      this.assertPendingMemberInvitation(invitation);
      const company = await this.requireCurrentCompany(invitation.organizationId);
      return { company_name: company.companyName };
    });
  }

  async assertInvitationCreationAllowed(input: {
    organizationId: string;
    email: string;
    role: string;
  }): Promise<void> {
    return this.run(async () => {
      if (input.role !== "member") {
        throw HumanInvitationAdmissionError.roleInvalid();
      }
      const email = normalizedEmail(input.email);
      const company = await this.requireCurrentCompany(input.organizationId);
      await this.rejectPreviouslyProjectedHuman(company.companyId, input.organizationId, email);
    });
  }

  async assertInvitationAcceptanceAllowed(input: {
    invitation: HumanInvitationAdmissionInvitation;
    userId: string;
    userEmail: string;
  }): Promise<void> {
    return this.run(async () => {
      const email = normalizedEmail(input.userEmail);
      this.assertPendingMemberInvitation(input.invitation);
      assertInvitationEmailMatches(input.invitation, email);
      const company = await this.requireCurrentCompany(input.invitation.organizationId);
      const hasMembership = await this.dependencies.invitations.hasAnyMembershipForAuthUser(input.userId);
      if (typeof hasMembership !== "boolean") {
        throw HumanInvitationAdmissionError.unavailable();
      }
      if (hasMembership) {
        throw HumanInvitationAdmissionError.secondCompany();
      }
      const hasRetainedHuman = await this.dependencies.humans.hasRetainedHumanForAuthUser(input.userId);
      if (typeof hasRetainedHuman !== "boolean") {
        throw HumanInvitationAdmissionError.unavailable();
      }
      if (hasRetainedHuman) {
        throw HumanInvitationAdmissionError.removedHuman();
      }
      await this.rejectPreviouslyProjectedHuman(
        company.companyId,
        input.invitation.organizationId,
        email,
      );
    });
  }

  async assertMappedOrganization(organizationId: string): Promise<void> {
    return this.run(async () => {
      await this.requireCurrentCompany(organizationId);
    });
  }

  private async requireInvitation(invitationId: string): Promise<HumanInvitationAdmissionInvitation> {
    const invitation = await this.dependencies.invitations.findInvitationById(invitationId);
    if (invitation === null) {
      throw HumanInvitationAdmissionError.invalid();
    }
    return invitation;
  }

  private async requireCurrentCompany(organizationId: string): Promise<ActiveInvitationCompany> {
    const company = await this.dependencies.companies.findActiveCompanyByAuthOrganizationId(organizationId);
    if (company === null) {
      throw HumanInvitationAdmissionError.invalid();
    }
    return company;
  }

  private assertPendingMemberInvitation(invitation: HumanInvitationAdmissionInvitation): void {
    if (
      invitation.status !== "pending"
      || invitation.role !== "member"
      || !Number.isFinite(invitation.expiresAtMs)
    ) {
      throw HumanInvitationAdmissionError.invalid();
    }
    const nowMs = this.dependencies.clock.now();
    if (!Number.isFinite(nowMs)) {
      throw HumanInvitationAdmissionError.unavailable();
    }
    if (invitation.expiresAtMs <= nowMs) {
      throw HumanInvitationAdmissionError.invalid();
    }
    normalizedEmail(invitation.email);
  }

  private async rejectPreviouslyProjectedHuman(
    companyId: string,
    organizationId: string,
    normalizedEmail: string,
  ): Promise<void> {
    const authorities = await this.dependencies.invitations.findEmailAuthorities({
      normalizedEmail,
      organizationId,
    });
    const authorityByUserId = authorityMap(authorities);
    if (authorityByUserId.size === 0) {
      return;
    }
    const humans = await this.dependencies.humans.listInvitationHumans({
      companyId,
      authUserIds: [...authorityByUserId.keys()],
    });
    const candidates = invitationHumans(humans, authorityByUserId);
    if (candidates.length === 0) {
      return;
    }
    if (candidates.some(({ human, hasOrganizationMembership }) => (
      human.status === "inactive" || !hasOrganizationMembership
    ))) {
      throw HumanInvitationAdmissionError.removedHuman();
    }
    throw HumanInvitationAdmissionError.existingHuman();
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HumanInvitationAdmissionError) {
        throw error;
      }
      throw HumanInvitationAdmissionError.unavailable();
    }
  }
}

/**
 * A transport-neutral safe failure. Better Auth and preview adapters map this
 * outcome to their respective existing HTTP contracts.
 */
export class HumanInvitationAdmissionError extends Error {
  private constructor(
    readonly failure: HumanInvitationAdmissionFailure,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HumanInvitationAdmissionError";
  }

  static invalid(): HumanInvitationAdmissionError {
    return new HumanInvitationAdmissionError(
      "invalid",
      HUMAN_INVITATION_ADMISSION_INVALID_CODE,
      "A valid pending Fields invitation is required.",
    );
  }

  static roleInvalid(): HumanInvitationAdmissionError {
    return new HumanInvitationAdmissionError(
      "role-invalid",
      HUMAN_INVITATION_ADMISSION_ROLE_INVALID_CODE,
      "Fields Human invitations must use the member role.",
    );
  }

  static secondCompany(): HumanInvitationAdmissionError {
    return new HumanInvitationAdmissionError(
      "second-company",
      HUMAN_INVITATION_ADMISSION_SECOND_COMPANY_CODE,
      "This account already belongs to a Company.",
    );
  }

  static removedHuman(): HumanInvitationAdmissionError {
    return new HumanInvitationAdmissionError(
      "removed-human",
      HUMAN_INVITATION_ADMISSION_REMOVED_HUMAN_CODE,
      "A removed Human cannot be invited again in this version.",
    );
  }

  static existingHuman(): HumanInvitationAdmissionError {
    return new HumanInvitationAdmissionError(
      "existing-human",
      HUMAN_INVITATION_ADMISSION_EXISTING_HUMAN_CODE,
      "This Human already belongs to the Fields Company.",
    );
  }

  static unavailable(): HumanInvitationAdmissionError {
    return new HumanInvitationAdmissionError(
      "unavailable",
      HUMAN_INVITATION_ADMISSION_UNAVAILABLE_CODE,
      "Invitation validation is temporarily unavailable.",
    );
  }
}

function authorityMap(authorities: readonly InvitationEmailAuthority[]): ReadonlyMap<string, boolean> {
  const result = new Map<string, boolean>();
  for (const authority of authorities) {
    if (
      !isAuthorityId(authority.authUserId)
      || typeof authority.hasOrganizationMembership !== "boolean"
      || result.has(authority.authUserId)
    ) {
      throw HumanInvitationAdmissionError.unavailable();
    }
    result.set(authority.authUserId, authority.hasOrganizationMembership);
  }
  return result;
}

function invitationHumans(
  humans: readonly InvitationHumanActor[],
  authorityByUserId: ReadonlyMap<string, boolean>,
): readonly { human: InvitationHumanActor; hasOrganizationMembership: boolean }[] {
  const result: { human: InvitationHumanActor; hasOrganizationMembership: boolean }[] = [];
  const seen = new Set<string>();
  for (const human of humans) {
    const hasOrganizationMembership = authorityByUserId.get(human.authUserId);
    if (
      !isAuthorityId(human.authUserId)
      || (human.status !== "active" && human.status !== "inactive")
      || hasOrganizationMembership === undefined
      || seen.has(human.authUserId)
    ) {
      throw HumanInvitationAdmissionError.unavailable();
    }
    seen.add(human.authUserId);
    result.push({ human, hasOrganizationMembership });
  }
  return result;
}

function assertInvitationEmailMatches(
  invitation: HumanInvitationAdmissionInvitation,
  normalizedEmail: string,
): void {
  if (normalizedEmailForInvitation(invitation.email) !== normalizedEmail) {
    throw HumanInvitationAdmissionError.invalid();
  }
}

function normalizedInvitationId(value: string | null): string {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 512 || /[\r\n]/u.test(normalized)) {
    throw HumanInvitationAdmissionError.invalid();
  }
  return normalized;
}

function normalizedEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw HumanInvitationAdmissionError.invalid();
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 255) {
    throw HumanInvitationAdmissionError.invalid();
  }
  return normalized;
}

function normalizedEmailForInvitation(value: unknown): string {
  return normalizedEmail(value);
}

function normalizedDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw HumanInvitationAdmissionError.invalid();
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 255) {
    throw HumanInvitationAdmissionError.invalid();
  }
  return normalized;
}

function isAuthorityId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
