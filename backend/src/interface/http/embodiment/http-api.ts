import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  EMBODIMENT_SCHEMA_VERSION,
  embodimentCallEndInputSchema,
  embodimentCallExchangeInputSchema,
  embodimentCallResultSchema,
  embodimentCallStartInputSchema,
  embodimentTerminalListErrorSchema,
  companyTerminalControlErrorSchema,
  companyTerminalRevokeResultSchema,
  pairingClaimInputSchema,
} from "@fields/contracts/public/embodiment";

import { EmbodimentApplication } from "../../../application/embodiment/index.js";
import type { InternalControlAuthorizationPort } from "../../../application/embodiment/ports.js";
import { TerminalNotFoundError } from "../../../domain/embodiment/index.js";

export type OwnerIdentity = { actor_id: string; company_id: string };
export type EmbodimentHttpApiOptions = {
  application: EmbodimentApplication;
  internalAuthorization: InternalControlAuthorizationPort;
  resolveOwner(request: FastifyRequest): Promise<OwnerIdentity | null>;
};

/** HTTP is an adapter: product rules live in the Embodiment application. */
export function registerEmbodimentHttpApi(app: FastifyInstance, options: EmbodimentHttpApiOptions): void {
  const owner = async (request: FastifyRequest, reply: { code(status: number): { send(body: unknown): unknown } }): Promise<OwnerIdentity | null> => {
    const value = await options.resolveOwner(request);
    if (value) return value;
    reply.code(403).send(terminalError("EMBODIMENT_TERMINAL_OWNER_REQUIRED", "An active Company Owner is required.", false));
    return null;
  };
  const internal = async (request: FastifyRequest, reply: { code(status: number): { send(body: unknown): unknown } }): Promise<boolean> => {
    if (await options.internalAuthorization.matches(request.headers.authorization)) return true;
    reply.code(401).send({ code: "EMBODIMENT_INTERNAL_UNAUTHORIZED" });
    return false;
  };

  app.get("/api/v1/embodiment/terminals", async (request, reply) => {
    const identity = await owner(request, reply);
    if (!identity) return;
    return options.application.listTerminals(identity.company_id);
  });
  app.get("/api/v1/embodiment/terminals/runtime", async (request, reply) => {
    const terminals = await options.application.listTerminalsForRuntime(runtimeHeaders(request));
    if (terminals === null) {
      return reply.code(403).send(embodimentTerminalListErrorSchema.parse({
        code: "runtime_identity_invalid",
        message: "Embodiment runtime identity is not authorized.",
        retryable: false,
      }));
    }
    return terminals;
  });
  app.post("/api/v1/embodiment/terminals/pairing/claim", async (request, reply) => {
    const identity = await owner(request, reply);
    if (!identity) return;
    const parsed = pairingClaimInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(terminalError("EMBODIMENT_PAIRING_INVALID", "The pairing code must contain six uppercase letters or digits.", false));
    const result = await options.application.claimPairing(identity.company_id, parsed.data.label, parsed.data.code);
    if (result === null) return reply.code(404).send(terminalError("EMBODIMENT_PAIRING_NOT_FOUND", "The pairing code is invalid or expired.", false));
    if (!result.delivered) return reply.code(409).send(terminalError("EMBODIMENT_PAIRING_DELIVERY_FAILED", "The terminal did not confirm its credentials.", true));
    return result.result;
  });
  app.post("/api/v1/embodiment/terminals/:terminalId/rotate", async (request, reply) => {
    const identity = await owner(request, reply);
    if (!identity) return;
    const terminalId = routeTerminalId(request);
    if (!terminalId) return reply.code(400).send(terminalError("EMBODIMENT_TERMINAL_INVALID", "The terminal identifier is invalid.", false));
    try {
      const result = await options.application.rotateTerminal(identity.company_id, terminalId);
      if (!result.delivered) return reply.code(409).send(terminalError("EMBODIMENT_TERMINAL_ROTATION_DELIVERY_FAILED", "The terminal did not confirm its rotated credentials.", true));
      return result.result;
    } catch (error) {
      return error instanceof TerminalNotFoundError
        ? reply.code(404).send(terminalError("EMBODIMENT_TERMINAL_NOT_FOUND", "The terminal was not found.", false))
        : reply.code(400).send(terminalError("EMBODIMENT_TERMINAL_ROTATION_INVALID", "The terminal credentials cannot be rotated.", false));
    }
  });
  app.post("/api/v1/embodiment/terminals/:terminalId/revoke", async (request, reply) => {
    const identity = await owner(request, reply);
    if (!identity) return;
    const terminalId = routeTerminalId(request);
    if (!terminalId) return reply.code(400).send(terminalError("EMBODIMENT_TERMINAL_INVALID", "The terminal identifier is invalid.", false));
    try {
      const result = await options.application.revokeTerminal(identity.company_id, terminalId);
      if (!result.disconnected) return reply.code(503).send(terminalError("EMBODIMENT_TERMINAL_RUNTIME_UNAVAILABLE", "The terminal cannot be disconnected right now.", true));
      return companyTerminalRevokeResultSchema.parse({ terminal_id: result.terminal_id });
    } catch (error) {
      return error instanceof TerminalNotFoundError
        ? reply.code(404).send(terminalError("EMBODIMENT_TERMINAL_NOT_FOUND", "The terminal was not found.", false))
        : reply.code(400).send(terminalError("EMBODIMENT_TERMINAL_INVALID", "The terminal cannot be revoked.", false));
    }
  });

  app.post("/api/v1/internal/embodiment/pairing/open", async (request, reply) => {
    if (!(await internal(request, reply))) return;
    const label = (request.body as { label?: unknown } | null)?.label;
    return options.application.openPairing(typeof label === "string" ? label : undefined);
  });
  app.post("/api/v1/internal/embodiment/terminals/authenticate", async (request, reply) => {
    if (!(await internal(request, reply))) return;
    const body = request.body as { terminal_id?: unknown; terminal_token?: unknown } | null;
    if (typeof body?.terminal_id !== "string" || typeof body.terminal_token !== "string") return reply.code(400).send({ authenticated: false });
    try {
      return { authenticated: await options.application.authenticateTerminal(body.terminal_id, body.terminal_token) };
    } catch {
      return { authenticated: false };
    }
  });

  const calls = [
    ["/api/v1/embodiment/call/start", embodimentCallStartInputSchema, "start"],
    ["/api/v1/embodiment/call/exchange", embodimentCallExchangeInputSchema, "exchange"],
    ["/api/v1/embodiment/call/end", embodimentCallEndInputSchema, "end"],
  ] as const;
  for (const [path, schema, method] of calls) {
    app.post(path, async (request, reply) => {
      const parsed = schema.safeParse(request.body);
      const operationId = operationIdFrom(request.body);
      if (!parsed.success) return reply.code(400).send(callFailure(operationId, "invalid_argument", false));
      const result = await options.application.invokeCall(runtimeHeaders(request), parsed.data, (actor) => options.application[method](actor, parsed.data));
      if (result === null) return reply.code(403).send(callFailure(parsed.data.operation_id, "forbidden", false));
      const valid = embodimentCallResultSchema.safeParse(result);
      return valid.success
        ? valid.data
        : reply.code(503).send(callFailure(parsed.data.operation_id, "runtime_unavailable", true));
    });
  }
}

function runtimeHeaders(request: FastifyRequest) {
  const value = (name: string): string | undefined => {
    const header = request.headers[name];
    return Array.isArray(header) ? header[0] : header;
  };
  return {
    memberId: value("x-fields-member-id"),
    kind: value("x-fields-runtime-kind"),
    runtimeId: value("x-fields-runtime-id"),
    authorization: value("authorization"),
  };
}

function routeTerminalId(request: FastifyRequest): string | null {
  const value = (request.params as { terminalId?: unknown }).terminalId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function terminalError(
  code: "EMBODIMENT_TERMINAL_OWNER_REQUIRED" | "EMBODIMENT_PAIRING_INVALID" | "EMBODIMENT_PAIRING_NOT_FOUND" | "EMBODIMENT_PAIRING_DELIVERY_FAILED" | "EMBODIMENT_TERMINAL_INVALID" | "EMBODIMENT_TERMINAL_NOT_FOUND" | "EMBODIMENT_TERMINAL_RUNTIME_UNAVAILABLE" | "EMBODIMENT_TERMINAL_ROTATION_DELIVERY_FAILED" | "EMBODIMENT_TERMINAL_ROTATION_INVALID",
  message: string,
  retryable: boolean,
) {
  return companyTerminalControlErrorSchema.parse({ code, message, retryable });
}

function operationIdFrom(body: unknown): string {
  return body && typeof body === "object" && typeof (body as { operation_id?: unknown }).operation_id === "string"
    ? (body as { operation_id: string }).operation_id
    : "invalid";
}

function callFailure(operationId: string, code: "invalid_argument" | "forbidden" | "runtime_unavailable", retryable: boolean) {
  return {
    schema_version: EMBODIMENT_SCHEMA_VERSION,
    ok: false as const,
    operation_id: operationId,
    error: { code, message: "Embodiment Call operation cannot be completed.", retryable },
  };
}
