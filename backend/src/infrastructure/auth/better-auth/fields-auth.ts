import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, organization } from "better-auth/plugins";

import type { BackendDatabase } from "../../persistence/postgres/database-service.js";
import {
  HumanInvitationAdmissionError,
  type CommittedMembershipActorProjection,
  type HumanInvitationAdmissionPolicyUseCase,
} from "../../../application/actor/index.js";
import * as databaseSchema from "../../persistence/postgres/schema/index.js";
import {
  expectedInvitationRenewalCredential,
  preserveExpiredInvitationIdentityForRenewal,
} from "./stable-invitation-renewal-adapter.js";
import { bindRegistrationGrant, currentRegistrationGrant } from "./registration-request-scope.js";
import { ApplicationError } from "../../../application/platform/errors.js";

export type FieldsAuthOptions = {
  database: BackendDatabase;
  secret: string;
  baseURL: string;
  trustedOrigins: readonly string[];
  /**
   * The Actor-owned, provider-neutral invitation policy. Both Better Auth
   * hooks and the public invitation preview receive the same composed
   * instance, so this adapter never reads invitation, Company, or Actor
   * persistence directly.
   */
  invitationPolicy: HumanInvitationAdmissionPolicyUseCase;
  /**
   * The provider-neutral, post-commit Actor projection boundary. Production
   * composition supplies this so Better Auth never reaches Actor persistence
   * or Home runtime side effects directly.
   */
  committedMembershipProjection: CommittedMembershipActorProjection;
  /**
   * Composition supplies the same public bearer header used by the HTTP
   * preview boundary. Keeping this value injected prevents this provider
   * adapter from reaching into Interface code.
   */
  invitationIdHeader?: string;
  registrationCredentialHeader?: string;
  registrationAdmission: {
    validateSignupCredential(input: { credential: string; email: string }): Promise<string | null>;
  };
};

/**
 * Creates the single Better Auth instance used by the product composition root.
 *
 * Sessions remain database-backed and cookies retain Better Auth's signed,
 * httpOnly defaults. The caller must provide the deployed backend URL and the
 * exact web origins; this module deliberately has no wildcard or
 * environment-specific origin fallback.
 */
export function createFieldsAuth(options: FieldsAuthOptions) {
  const secret = authSecret(options.secret);
  const baseURL = absoluteUrl(options.baseURL, "Better Auth base URL");
  const trustedOrigins = normalizedTrustedOrigins(options.trustedOrigins);
  const invitationPolicy = options.invitationPolicy;
  const committedMembershipProjection = options.committedMembershipProjection;
  const invitationIdHeader = options.invitationIdHeader ?? "X-Fields-Invitation-Id";
  const registrationCredentialHeader = options.registrationCredentialHeader
    ?? "X-Fields-Registration-Credential";

  return betterAuth({
    appName: "Fields",
    baseURL,
    basePath: "/api/auth",
    secret,
    database: preserveExpiredInvitationIdentityForRenewal(
      drizzleAdapter(options.database, {
        provider: "pg",
        schema: databaseSchema,
      }),
    ),
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        registrationGrantId: {
          type: "string",
          required: false,
          input: false,
          fieldName: "registration_grant_id",
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (createdUser) => {
            const grantId = currentRegistrationGrant();
            return grantId
              ? { data: { ...createdUser, registrationGrantId: grantId } }
              : { data: createdUser };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === "/organization/invite-member") {
          throw new APIError("FORBIDDEN", {
            code: "FIELDS_MEMBER_INVITATIONS_DISABLED",
            message: "New member invitations are disabled.",
          });
        }
        if (context.path !== "/sign-up/email") {
          return;
        }
        const invitationId = context.getHeader(invitationIdHeader);
        if (invitationId) {
          try {
            await invitationPolicy.assertEmailSignUpAllowed({
              invitationId,
              email: context.body.email,
              name: context.body.name,
            });
            return;
          } catch (error) {
            throw invitationApiError(error);
          }
        }
        const registrationCredential = context.getHeader(registrationCredentialHeader);
        try {
          const grantId = await options.registrationAdmission.validateSignupCredential({
            credential: registrationCredential ?? "",
            email: typeof context.body.email === "string" ? context.body.email : "",
          });
          if (grantId) bindRegistrationGrant(grantId);
        } catch (error) {
          throw registrationApiError(error);
        }
      }),
    },
    // Better Auth and better-call otherwise log unknown adapter errors before
    // returning their generic 500 response. Drizzle includes SQL parameters in
    // those errors, which can contain bearer credentials such as Invitation IDs
    // and Session tokens. Rethrow unknown router errors to the Fields Fetch
    // adapter, where they are converted to a cause-less response without logging
    // the original error.
    onAPIError: {
      throw: true,
    },
    // Some Better Auth endpoints (notably getSession) log adapter errors inside
    // the endpoint before the router error boundary runs. Those errors can
    // contain SQL parameters such as Session tokens or Invitation IDs, so the
    // library logger must remain disabled and sanitized failures are handled by
    // the Fields HTTP boundary above it.
    logger: {
      disabled: true,
    },
    trustedOrigins,
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        // The copied opaque ID is the approved invitation bearer credential. The
        // composition root must separately reject Organization-wide listing.
        requireEmailVerificationOnInvitation: false,
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => {
            if (expectedInvitationRenewalCredential()) {
              throw new APIError("CONFLICT", {
                code: "FIELDS_INVITATION_RENEWAL_CREDENTIAL_UNAVAILABLE",
                message: "The invitation selected for renewal is no longer pending.",
              });
            }
            try {
              await invitationPolicy.assertInvitationCreationAllowed({
                organizationId: invitation.organizationId,
                email: invitation.email,
                role: invitation.role,
              });
              return {
                data: {
                  ...invitation,
                  role: "member",
                },
              };
            } catch (error) {
              throw invitationApiError(error);
            }
          },
          beforeAcceptInvitation: async ({ invitation, user }) => {
            try {
              await invitationPolicy.assertInvitationAcceptanceAllowed({
                invitation: {
                  organizationId: invitation.organizationId,
                  email: invitation.email,
                  role: invitation.role,
                  status: invitation.status,
                  expiresAtMs: invitation.expiresAt.getTime(),
                },
                userId: user.id,
                userEmail: user.email,
              });
            } catch (error) {
              throw invitationApiError(error);
            }
          },
          afterAcceptInvitation: async ({ member, user }) => {
            await reconcileCommittedProjectionBestEffort(() => (
              committedMembershipProjection.reconcileAcceptedMembership({
                organizationId: member.organizationId,
                authUserId: user.id,
              })
            ));
          },
          beforeRemoveMember: async ({ member }) => {
            if (member.role !== "member") {
              throw new APIError("FORBIDDEN", {
                code: "FIELDS_OWNER_REMOVAL_FORBIDDEN",
                message: "The Fields Company owner cannot be removed.",
              });
            }
            try {
              await invitationPolicy.assertMappedOrganization(member.organizationId);
            } catch (error) {
              throw invitationApiError(error);
            }
          },
          afterRemoveMember: async ({ member, user }) => {
            await reconcileCommittedProjectionBestEffort(() => (
              committedMembershipProjection.reconcileRemovedMembership({
                organizationId: member.organizationId,
                authUserId: user.id,
              })
            ));
          },
          beforeUpdateMemberRole: async () => {
            throw new APIError("FORBIDDEN", {
              code: "FIELDS_MEMBER_ROLE_UPDATE_FORBIDDEN",
              message: "Fields Company roles cannot be changed in this version.",
            });
          },
          beforeDeleteOrganization: async () => {
            throw new APIError("FORBIDDEN", {
              code: "FIELDS_ORGANIZATION_DELETE_FORBIDDEN",
              message: "The Fields Company Organization cannot be deleted.",
            });
          },
        },
      }),
      admin(),
    ],
  });
}

function registrationApiError(error: unknown): APIError {
  if (error instanceof ApplicationError && !error.retryable) {
    return new APIError("FORBIDDEN", {
      code: "FIELDS_REGISTRATION_INVALID",
      message: "Registration is unavailable.",
    });
  }
  return new APIError("INTERNAL_SERVER_ERROR", {
    code: "FIELDS_REGISTRATION_UNAVAILABLE",
    message: "Registration is temporarily unavailable.",
  });
}

export type FieldsAuth = ReturnType<typeof createFieldsAuth>;

function invitationApiError(error: unknown): unknown {
  if (error instanceof HumanInvitationAdmissionError) {
    switch (error.failure) {
      case "invalid":
        return new APIError("FORBIDDEN", {
          code: error.code,
          message: error.message,
        });
      case "role-invalid":
        return new APIError("BAD_REQUEST", {
          code: error.code,
          message: error.message,
        });
      case "second-company":
      case "removed-human":
      case "existing-human":
        return new APIError("CONFLICT", {
          code: error.code,
          message: error.message,
        });
      case "unavailable":
        break;
    }
  }
  // Drizzle includes SQL parameter values in its wrapped error message. The
  // invitation ID is a bearer secret, so never let an unknown persistence
  // error (or its cause) cross into Better Auth's default logger.
  return new APIError("INTERNAL_SERVER_ERROR", {
    code: "FIELDS_INVITATION_POLICY_UNAVAILABLE",
    message: "Invitation validation is temporarily unavailable.",
  });
}

export type CommittedProjectionAttempt<T> =
  | { ok: true; value: T }
  | { ok: false; error: AggregateError };

/**
 * Best-effort immediate repair for a Better Auth mutation that has already
 * committed. A failed repair must not make the official endpoint claim that
 * its membership mutation rolled back; ProductSession retries and fails closed.
 */
export async function reconcileCommittedProjectionBestEffort<T>(
  operation: () => Promise<T>,
): Promise<CommittedProjectionAttempt<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (firstError) {
    try {
      return { ok: true, value: await operation() };
    } catch (retryError) {
      return {
        ok: false,
        error: new AggregateError(
          [firstError, retryError],
          "Committed Better Auth state could not be projected.",
        ),
      };
    }
  }
}

function requiredValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new FieldsAuthConfigurationError(`${label} is required.`);
  }
  return normalized;
}

function authSecret(value: string): string {
  const secret = requiredValue(value, "Better Auth secret");
  if (secret.length < 32) {
    throw new FieldsAuthConfigurationError("Better Auth secret must contain at least 32 characters.");
  }
  return secret;
}

function absoluteUrl(value: string, label: string): string {
  const normalized = requiredValue(value, label);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new FieldsAuthConfigurationError(`${label} must be an absolute URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FieldsAuthConfigurationError(`${label} must use http or https.`);
  }
  return url.toString().replace(/\/$/u, "");
}

function normalizedTrustedOrigins(origins: readonly string[]): string[] {
  const normalized = [...new Set(origins.map((origin) => origin.trim()).filter(Boolean))];
  if (normalized.length === 0) {
    throw new FieldsAuthConfigurationError("At least one explicit Better Auth trusted origin is required.");
  }
  if (normalized.some((origin) => origin === "*" || origin.includes("*"))) {
    throw new FieldsAuthConfigurationError("Wildcard Better Auth trusted origins are not allowed.");
  }
  return normalized;
}

export class FieldsAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldsAuthConfigurationError";
  }
}
