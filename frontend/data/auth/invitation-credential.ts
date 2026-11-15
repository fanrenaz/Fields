export const INVITATION_CREDENTIAL_HEADER = "X-Fields-Invitation-Id";

const INVITATION_KEY = "invitation";
const MAX_INVITATION_ID_LENGTH = 512;

export function invitationIdFromUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const fragmentValue = credentialFromParams(new URLSearchParams(url.hash.slice(1)));
  return fragmentValue;
}

export function buildInvitationLink(invitationId: string, baseUrl: string): string {
  const credential = validInvitationId(invitationId);
  if (!credential) {
    throw new Error("The invitation credential is invalid.");
  }

  const url = new URL(baseUrl);
  url.hash = `${INVITATION_KEY}=${encodeURIComponent(credential)}`;
  return url.toString();
}

function credentialFromParams(params: URLSearchParams): string | null {
  const values = params.getAll(INVITATION_KEY);
  if (values.length !== 1) return null;
  return validInvitationId(values[0] ?? "");
}

function validInvitationId(value: string): string | null {
  if (value.length === 0 || value.length > MAX_INVITATION_ID_LENGTH || /\s/u.test(value)) {
    return null;
  }
  return value;
}
