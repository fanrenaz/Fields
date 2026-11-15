import type {
  ProductSession,
} from "@fields/contracts/public/company";

import { authClient, authFetch } from "../boundary/auth-client";
import { isProductAccessError, productSessionFrom } from "./auth-state";
import { backendAuthBaseUrl } from "../boundary/backend-url";
import { backendTrpc, rebuildBackendTransport } from "../boundary/backend-trpc";
import { INVITATION_CREDENTIAL_HEADER } from "./invitation-credential";

/**
 * The verified Better Auth identity needed by the browser-facing Auth controller.
 * Session tokens deliberately do not cross this port.
 */
export type AuthSessionIdentity = {
  displayName: string;
  email: string;
};

export type InvitationPreview = {
  companyName: string;
};

export type AuthRequestOptions = {
  signal: AbortSignal;
};

class PublicAuthServiceError extends Error {}

export type AuthMachineServices = {
  getAuthSession: (options: AuthRequestOptions) => Promise<AuthSessionIdentity | null>;
  getBootstrapAvailability: (options: AuthRequestOptions) => Promise<boolean>;
  previewInvitation: (
    input: { credential: string },
    options: AuthRequestOptions,
  ) => Promise<InvitationPreview>;
  bootstrapOwner: (
    input: { displayName: string; email: string; password: string },
    options: AuthRequestOptions,
  ) => Promise<AuthSessionIdentity>;
  login: (
    input: { email: string; password: string },
    options: AuthRequestOptions,
  ) => Promise<AuthSessionIdentity>;
  signUpWithInvitation: (
    input: { credential: string; displayName: string; email: string; password: string },
    options: AuthRequestOptions,
  ) => Promise<AuthSessionIdentity>;
  acceptInvitation: (
    input: { credential: string },
    options: AuthRequestOptions,
  ) => Promise<void>;
  /**
   * Return null only for an authenticated identity without Product access.
   * Transport and unexpected failures must reject so the machine can expose a
   * retryable fatal error instead of silently degrading into noAccess.
   */
  resolveProductSession: (options: AuthRequestOptions) => Promise<ProductSession | null>;
  changePassword: (
    input: {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions: boolean;
    },
    options: AuthRequestOptions,
  ) => Promise<void>;
  logout: (options: AuthRequestOptions) => Promise<void>;
};

/** Production service adapter used by the eventual React boundary. */
export const defaultAuthMachineServices: AuthMachineServices = {
  async getAuthSession({ signal }) {
    return readAuthIdentity(signal);
  },
  async getBootstrapAvailability({ signal }) {
    const response = await authFetch(authEndpoint("/api/v1/auth/bootstrap/status"), { signal });
    if (!response.ok) throw new Error(await responseError(response, "Unable to read bootstrap status."));
    const value = await response.json() as unknown;
    return typeof value === "object" && value !== null && (value as { available?: unknown }).available === true;
  },
  async previewInvitation({ credential }, { signal }) {
    const response = await authFetch(authEndpoint("/api/v1/auth/invitation/preview"), {
      method: "POST",
      headers: { [INVITATION_CREDENTIAL_HEADER]: credential },
      signal,
    });
    if (!response.ok) throw new Error(await responseError(response, "This invitation is unavailable."));
    const value = await response.json() as unknown;
    const companyName = typeof value === "object" && value !== null
      ? (value as { company_name?: unknown }).company_name
      : null;
    if (typeof companyName !== "string" || companyName.trim().length === 0) {
      throw new Error("This invitation is unavailable.");
    }
    return { companyName };
  },
  async bootstrapOwner({ displayName, email, password }, { signal }) {
    const response = await authFetch(authEndpoint("/api/v1/auth/bootstrap"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: displayName, email, password }),
      signal,
    });
    if (!response.ok) throw new Error(await responseError(response, "Unable to create the owner account."));
    return loginAndReadIdentity({ email, password }, signal);
  },
  async login({ email, password }, { signal }) {
    return loginAndReadIdentity({ email, password }, signal);
  },
  async signUpWithInvitation({ credential, displayName, email, password }, { signal }) {
    const result = await authClient.signUp.email({ name: displayName, email, password }, {
      headers: { [INVITATION_CREDENTIAL_HEADER]: credential },
      signal,
    });
    if (result.error) throw new Error("Unable to create the account.");
    rebuildBackendTransport();
    return requireAuthIdentity(signal);
  },
  async acceptInvitation({ credential }, { signal }) {
    const result = await authClient.organization.acceptInvitation(
      { invitationId: credential },
      { signal },
    );
    if (result.error) throw new Error("Unable to accept the invitation.");
    rebuildBackendTransport();
  },
  async resolveProductSession({ signal }) {
    try {
      return productSessionFrom(await backendTrpc.session.me.query(undefined, { signal }));
    } catch (error) {
      if (isProductAccessError(error)) return null;
      throw error;
    }
  },
  async changePassword({ currentPassword, newPassword, revokeOtherSessions }, { signal }) {
    const result = await authClient.changePassword(
      { currentPassword, newPassword, revokeOtherSessions },
      { signal },
    );
    if (result.error) throw new Error("Unable to change the password.");
    rebuildBackendTransport();
  },
  async logout({ signal }) {
    const result = await authClient.signOut({ fetchOptions: { signal } });
    rebuildBackendTransport();
    if (result.error) throw new Error("Unable to log out.");
  },
};

export function authServiceErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PublicAuthServiceError) {
    const detail = error.message.trim();
    if (detail.length > 0) return detail;
  }
  if (!(error instanceof Error) && typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      const detail = message.trim();
      if (detail.length > 0) return detail;
    }
  }
  return fallback;
}

async function loginAndReadIdentity(
  input: { email: string; password: string },
  signal: AbortSignal,
): Promise<AuthSessionIdentity> {
  const result = await authClient.signIn.email(input, { signal });
  if (result.error) {
    throw new PublicAuthServiceError(authServiceErrorMessage(result.error, "Unable to log in."));
  }
  rebuildBackendTransport();
  return requireAuthIdentity(signal);
}

async function requireAuthIdentity(signal: AbortSignal): Promise<AuthSessionIdentity> {
  const identity = await readAuthIdentity(signal);
  if (!identity) throw new Error("Authentication completed without a verified session.");
  return identity;
}

async function readAuthIdentity(signal: AbortSignal): Promise<AuthSessionIdentity | null> {
  const result = await authClient.getSession({ fetchOptions: { signal } });
  if (result.error) throw new Error("Unable to read authentication session.");
  if (!result.data) return null;
  return {
    displayName: result.data.user.name,
    email: result.data.user.email,
  };
}

function authEndpoint(pathname: string): string {
  return new URL(pathname, backendAuthBaseUrl()).toString();
}

async function responseError(response: Response, fallback: string): Promise<string> {
  void response;
  return fallback;
}
