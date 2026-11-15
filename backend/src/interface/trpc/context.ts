import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { FastifyRequest } from "fastify";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

import {
  ProductSessionResolver,
  resolveProductAuthContext,
  type ProductAuthSessionResolver,
} from "./product-session.js";
import type { BackendTrpcContext } from "./core.js";
import { clientTelemetryContext } from "../http/client-telemetry.js";

export type TrpcTransportAuthentication = ProductAuthSessionResolver & {
  headersFromHttp(headers: IncomingHttpHeaders): Headers;
  headersFromWebSocket(
    headers: IncomingHttpHeaders,
    connectionParams: unknown,
    trustedOrigins: readonly string[],
  ): Headers;
};

export type BackendTrpcContextDependencies = Omit<
  BackendTrpcContext,
  "authContext" | "authorizationHeader" | "traceparent" | "clientTelemetry"
> & {
  authentication: TrpcTransportAuthentication;
  productSessionResolver: ProductSessionResolver;
  authTrustedOrigins: readonly string[];
};

export async function createBackendTrpcContext(
  dependencies: BackendTrpcContextDependencies,
  req: FastifyRequest | IncomingMessage,
  connectionParams: CreateFastifyContextOptions["info"]["connectionParams"],
): Promise<BackendTrpcContext> {
  const authHeaders = "raw" in req
    ? dependencies.authentication.headersFromHttp(req.headers)
    : dependencies.authentication.headersFromWebSocket(
      req.headers,
      connectionParams,
      dependencies.authTrustedOrigins,
    );
  const {
    authentication,
    productSessionResolver,
    authTrustedOrigins: _authTrustedOrigins,
    ...services
  } = dependencies;
  return {
    ...services,
    authContext: await resolveProductAuthContext(authentication, productSessionResolver, authHeaders),
    authorizationHeader: Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization,
    traceparent: traceparent(connectionParams),
    clientTelemetry: clientTelemetryContext(req.headers, "web"),
  };
}

function traceparent(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>).traceparent;
  return typeof candidate === "string" ? candidate : undefined;
}
