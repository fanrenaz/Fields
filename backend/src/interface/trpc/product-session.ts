import type {
  ProductSession,
} from "@fields/contracts/public/company";

import type { ProductSessionQuery } from "../../application/actor/index.js";

/**
 * Provider-neutral facts already verified by the transport's authentication
 * adapter. Interface deliberately needs no Better Auth instance or API type.
 */
export type VerifiedProductAuthSession = {
  user: {
    id: string;
    name: string;
    banned?: boolean | null;
  };
  session: {
    id?: string | null;
    activeOrganizationId?: string | null;
  };
};

/** Compatibility name for callers that previously consumed the auth adapter type. */
export type VerifiedBetterAuthSession = VerifiedProductAuthSession;

export type ProductAuthSessionResolver = {
  resolve(headers: Headers): Promise<VerifiedProductAuthSession | null>;
};

export type ProductAuthContext = {
  /** A defensive copy that retains the verified Cookie for owner org APIs. */
  authHeaders: Headers;
  authSession: VerifiedProductAuthSession | null;
  productSession: ProductSession | null;
};

/**
 * Auth transport adapter for the provider-neutral Product Session projection.
 * The Application query owns authorization, projection repair, and all product
 * reads; this adapter only keeps Better Auth and the public contract at their
 * respective boundaries.
 */
export class ProductSessionResolver {
  constructor(private readonly productSessionQuery: ProductSessionQuery) {}

  async resolve(authSession: VerifiedProductAuthSession): Promise<ProductSession | null> {
    if (authSession.user.banned === true) {
      return null;
    }

    let actor;
    try {
      actor = await this.productSessionQuery.resolveVerifiedSession({
        authUserId: authSession.user.id,
        activeOrganizationId: authSession.session.activeOrganizationId ?? null,
      });
    } catch {
      // Authentication is fail-closed. In particular, no provider or
      // persistence failure must escape through a public auth context.
      return null;
    }
    if (!actor) {
      return null;
    }

    return {
      actor_id: actor.actorId,
      company_id: actor.companyId,
      display_name: actor.displayName,
      actor_type: actor.actorType,
      company_role: actor.companyRole,
      company_status: actor.companyStatus,
    };
  }
}

/**
 * Shared HTTP/WebSocket context entrypoint after the transport-specific header
 * helper has selected the Cookie credential. No actor/company fallback exists.
 */
export async function resolveProductAuthContext(
  auth: ProductAuthSessionResolver,
  resolver: ProductSessionResolver,
  headers: Headers,
): Promise<ProductAuthContext> {
  const authHeaders = new Headers(headers);
  const authSession = await auth.resolve(authHeaders);
  if (!authSession) {
    return {
      authHeaders,
      authSession: null,
      productSession: null,
    };
  }
  return {
    authHeaders,
    authSession,
    productSession: await resolver.resolve(authSession),
  };
}

export function requireProductAuthContext(context: ProductAuthContext): {
  authHeaders: Headers;
  authSession: VerifiedProductAuthSession;
  productSession: ProductSession;
} {
  if (!context.authSession || !context.productSession) {
    throw new ProductSessionUnavailableError();
  }
  return {
    authHeaders: context.authHeaders,
    authSession: context.authSession,
    productSession: context.productSession,
  };
}

export class ProductSessionUnavailableError extends Error {
  constructor() {
    super("The authenticated user does not have active Fields product access.");
    this.name = "ProductSessionUnavailableError";
  }
}
