import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";

import type { FieldsAuth } from "./fields-auth.js";

export type VerifiedBetterAuthSession = NonNullable<
  Awaited<ReturnType<FieldsAuth["api"]["getSession"]>>
>;

export type BetterAuthConnectionParams = {
  actor_id?: unknown;
  company_id?: unknown;
  actorId?: unknown;
  companyId?: unknown;
  traceparent?: unknown;
};

/** Resolve a database-backed Better Auth session from already trusted headers. */
export async function getBetterAuthSession(
  auth: FieldsAuth,
  headers: Headers,
): Promise<VerifiedBetterAuthSession | null> {
  return auth.api.getSession({ headers });
}

/** Convert Fastify/Node HTTP headers for Better Auth's server API. */
export function betterAuthHeadersFromHttp(headers: IncomingHttpHeaders): Headers {
  return fromNodeHeaders(headers);
}

/**
 * Build the only credential surface accepted by the product WebSocket.
 *
 * Web clients authenticate with the handshake Cookie header. Connection
 * parameters never carry authentication facts; Actor/company IDs are
 * explicitly rejected and are never interpreted as identity facts.
 */
export function betterAuthHeadersFromWebSocket(
  requestHeaders: IncomingHttpHeaders,
  connectionParams?: unknown,
  allowedWebOrigins: readonly string[] = [],
): Headers {
  const headers = fromNodeHeaders(requestHeaders);
  const params = connectionParamsObject(connectionParams);
  rejectLegacyIdentityParams(params);
  rejectUnsupportedConnectionParams(params);
  requireTrustedWebOrigin(requestHeaders.origin, allowedWebOrigins);
  return headers;
}

function rejectUnsupportedConnectionParams(params: Record<string, unknown>): void {
  if (Object.keys(params).some((key) => key !== "traceparent")) {
    throw new AuthCredentialError("Unsupported WebSocket connection parameters.");
  }
  if (params.traceparent !== undefined && !isTraceparent(params.traceparent)) {
    throw new AuthCredentialError("WebSocket trace context is invalid.");
  }
}

/** Trace context is propagation metadata, never a credential or product fact. */
export function traceparentFromConnectionParams(connectionParams: unknown): string | undefined {
  const params = connectionParamsObject(connectionParams);
  return isTraceparent(params.traceparent) ? params.traceparent : undefined;
}

function requireTrustedWebOrigin(
  originHeader: string | string[] | undefined,
  allowedOrigins: readonly string[],
): void {
  const origin = singleHeader(originHeader);
  if (!origin) {
    throw new AuthCredentialError("WebSocket web authentication requires a trusted Origin.");
  }
  const normalizedOrigin = normalizedHttpOrigin(origin);
  const trusted = allowedOrigins.some((allowedOrigin) => (
    normalizedHttpOrigin(allowedOrigin) === normalizedOrigin
  ));
  if (!normalizedOrigin || !trusted) {
    throw new AuthCredentialError("WebSocket Origin is not trusted.");
  }
}

function singleHeader(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (Array.isArray(value) && value.length === 1) {
    return value[0]?.trim() || null;
  }
  return null;
}

function normalizedHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function connectionParamsObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AuthCredentialError("WebSocket connection parameters must be an object.");
  }
  return value as Record<string, unknown>;
}

function isTraceparent(value: unknown): value is string {
  return typeof value === "string"
    && /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}(?:-[\da-z-]+)?$/u.test(value);
}

function rejectLegacyIdentityParams(params: Record<string, unknown>): void {
  if (
    "actor_id" in params ||
    "company_id" in params ||
    "actorId" in params ||
    "companyId" in params
  ) {
    throw new AuthCredentialError("Actor and company identifiers are not authentication credentials.");
  }
}

export class AuthCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthCredentialError";
  }
}
