import type {
  CompanyActor,
  CompanyInvitation,
} from "@fields/contracts/public/company";

import { sortCompanyActors } from "./member-model";

export type MemberDirectoryLoadResult = {
  members: CompanyActor[];
  invitations: CompanyInvitation[];
  memberError: unknown | null;
  invitationError: unknown | null;
};

export async function loadMemberDirectory(input: {
  currentMembers: readonly CompanyActor[];
  currentInvitations: readonly CompanyInvitation[];
  loadMembers: () => Promise<readonly CompanyActor[]>;
  loadInvitations: () => Promise<readonly CompanyInvitation[]>;
}): Promise<MemberDirectoryLoadResult> {
  const [members, invitations] = await Promise.allSettled([
    input.loadMembers(),
    input.loadInvitations(),
  ]);
  return {
    members: members.status === "fulfilled"
      ? sortCompanyActors(members.value)
      : [...input.currentMembers],
    invitations: invitations.status === "fulfilled"
      ? [...invitations.value]
      : [...input.currentInvitations],
    memberError: members.status === "rejected" ? members.reason : null,
    invitationError: invitations.status === "rejected" ? invitations.reason : null,
  };
}
