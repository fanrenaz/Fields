import { authClient } from "../boundary/auth-client";
import { UiMessageError } from "../../shared/i18n";
export async function revokeHumanInvitation(invitationCredential: string): Promise<void> {
  const result = await authClient.organization.cancelInvitation({
    invitationId: invitationCredential,
  });
  if (result.error) throw new UiMessageError("member.unableToRevokeInvitation");
}

export async function removeHumanMember(email: string): Promise<void> {
  const organizationId = await activateOnlyOrganization();
  const result = await authClient.organization.removeMember({
    memberIdOrEmail: email,
    organizationId,
  });
  if (result.error) throw new UiMessageError("member.unableToRemoveMember");
}

async function activateOnlyOrganization(): Promise<string> {
  const listResult = await authClient.organization.list();
  if (listResult.error) throw new UiMessageError("member.unableToLoadOrganization");
  if (!listResult.data || listResult.data.length !== 1) {
    throw new UiMessageError("member.organizationMembershipRequired");
  }

  const organizationId = listResult.data[0].id;
  const activeResult = await authClient.organization.setActive({ organizationId });
  if (activeResult.error) throw new UiMessageError("member.unableToSelectOrganization");
  return organizationId;
}
