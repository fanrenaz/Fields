import { buildInvitationLink, invitationIdFromUrl } from "./invitation-credential";

export function invitationLinkForWeb(invitationId: string): string {
  if (typeof window === "undefined") {
    throw new Error("A browser origin is required to create an invitation link.");
  }
  const baseUrl = new URL("/", window.location.origin).toString();
  return buildInvitationLink(invitationId, baseUrl);
}

export function invitationIdFromWebUrl(rawUrl: string): string | null {
  return invitationIdFromUrl(rawUrl);
}

export function consumeWebInvitationCredential(): string | null {
  if (typeof window === "undefined") return null;
  const rawUrl = window.location.href;
  const credential = invitationIdFromWebUrl(rawUrl);
  if (credential) clearVisibleWebInvitationCredential(rawUrl);
  return credential;
}

export function subscribeToWebInvitationCredentials(
  listener: (credential: string) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const receiveHashChange = () => {
    const credential = consumeWebInvitationCredential();
    if (credential) listener(credential);
  };
  window.addEventListener("hashchange", receiveHashChange);
  return () => window.removeEventListener("hashchange", receiveHashChange);
}

export function clearVisibleWebInvitationCredential(rawUrl: string): void {
  if (typeof window === "undefined" || typeof history === "undefined") return;
  if (!invitationIdFromUrl(rawUrl)) return;

  const url = new URL(rawUrl);
  url.hash = "";
  try {
    history.replaceState(history.state, "", `${url.pathname}${url.search}`);
  } catch {
    // The fragment is never sent in HTTP requests or referrers even when a
    // constrained browser prevents replacing the visible URL.
  }
}
