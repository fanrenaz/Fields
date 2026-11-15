import type {
  CompanyActor,
  CompanyInvitation,
  CompanyInvitationStatus,
} from "@fields/contracts/public/company";

export type CompanyMemberDirectoryEntry =
  | { kind: "member"; member: CompanyActor }
  | { kind: "invitation"; invitation: CompanyInvitation };

export function sortCompanyActors(actors: readonly CompanyActor[]): CompanyActor[] {
  return [...actors].sort((left, right) => {
    if (left.company_role !== right.company_role) {
      return left.company_role === "owner" ? -1 : 1;
    }
    const displayNameOrder = left.display_name.localeCompare(right.display_name);
    return displayNameOrder !== 0 ? displayNameOrder : left.actor_id.localeCompare(right.actor_id);
  });
}

export function upsertCompanyActor(actors: readonly CompanyActor[], actor: CompanyActor): CompanyActor[] {
  return sortCompanyActors([
    ...actors.filter((candidate) => candidate.actor_id !== actor.actor_id),
    actor,
  ]);
}

export function sortCompanyMemberDirectory(
  members: readonly CompanyActor[],
  invitations: readonly CompanyInvitation[],
): CompanyMemberDirectoryEntry[] {
  return [
    ...members.map((member): CompanyMemberDirectoryEntry => ({ kind: "member", member })),
    ...invitations.map((invitation): CompanyMemberDirectoryEntry => ({
      kind: "invitation",
      invitation,
    })),
  ].sort((left, right) => {
    const leftOwner = left.kind === "member" && left.member.company_role === "owner";
    const rightOwner = right.kind === "member" && right.member.company_role === "owner";
    if (leftOwner !== rightOwner) return leftOwner ? -1 : 1;
    const labelOrder = entryLabel(left).localeCompare(entryLabel(right));
    if (labelOrder !== 0) return labelOrder;
    if (left.kind !== right.kind) return left.kind === "member" ? -1 : 1;
    return entryId(left).localeCompare(entryId(right));
  });
}

export function upsertCompanyInvitation(
  invitations: readonly CompanyInvitation[],
  invitation: CompanyInvitation,
): CompanyInvitation[] {
  return [
    ...invitations.filter((candidate) => (
      candidate.invitation_credential !== invitation.invitation_credential
    )),
    invitation,
  ];
}

export function companyInvitationStatusAt(
  invitation: Pick<CompanyInvitation, "status" | "expires_at_ms">,
  nowMs: number,
): CompanyInvitationStatus {
  return invitation.status === "expired" || invitation.expires_at_ms <= nowMs
    ? "expired"
    : "pending";
}

export function expireCompanyInvitationsAt(
  invitations: readonly CompanyInvitation[],
  nowMs: number,
): CompanyInvitation[] {
  let changed = false;
  const projected = invitations.map((invitation) => {
    const status = companyInvitationStatusAt(invitation, nowMs);
    if (status === invitation.status) return invitation;
    changed = true;
    return { ...invitation, status };
  });
  return changed ? projected : invitations as CompanyInvitation[];
}

export function serverInvitationAllowsCopy(
  invitations: readonly CompanyInvitation[],
  invitationCredential: string,
): boolean {
  return invitations.some((invitation) => (
    invitation.invitation_credential === invitationCredential
    && invitation.status === "pending"
  ));
}

export function renewedCompanyInvitation(
  invitations: readonly CompanyInvitation[],
  invitationCredential: string,
  nowMs: number,
): CompanyInvitation | null {
  return invitations.find((invitation) => (
    invitation.invitation_credential === invitationCredential
    && companyInvitationStatusAt(invitation, nowMs) === "pending"
  )) ?? null;
}

export function removeCompanyInvitation(
  invitations: readonly CompanyInvitation[],
  invitationCredential: string,
): CompanyInvitation[] {
  return invitations.filter((invitation) => (
    invitation.invitation_credential !== invitationCredential
  ));
}

export function actorSelectionAfterRemoval(
  selectedActorId: string,
  removedActorId: string,
  currentActorId: string,
): string {
  return selectedActorId === removedActorId ? currentActorId : selectedActorId;
}

export function invitationSelectionAfterRevocation(
  selectedInvitationCredential: string | null,
  revokedInvitationCredential: string,
  currentActorId: string,
): { kind: "member"; actorId: string } | null {
  return selectedInvitationCredential === revokedInvitationCredential
    ? { kind: "member", actorId: currentActorId }
    : null;
}

function entryLabel(entry: CompanyMemberDirectoryEntry): string {
  return entry.kind === "member" ? entry.member.display_name : entry.invitation.email;
}

function entryId(entry: CompanyMemberDirectoryEntry): string {
  return entry.kind === "member"
    ? entry.member.actor_id
    : entry.invitation.invitation_credential;
}
