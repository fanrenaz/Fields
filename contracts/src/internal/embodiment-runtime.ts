import { z } from "zod";

import {
  embodimentCallEndInputSchema,
  embodimentCallEndResultSchema,
  embodimentCallExchangeInputSchema,
  embodimentCallExchangeResultSchema,
  embodimentCallStartInputSchema,
  embodimentCallStartResultSchema,
  terminalIdSchema,
} from "../public/embodiment.js";

export const embodimentRuntimeActorSchema = z.strictObject({ actor_id: z.string().min(1).max(128), company_id: z.string().min(1).max(128) });
export const embodimentRuntimeStartInputSchema = z.strictObject({ actor: embodimentRuntimeActorSchema, call: embodimentCallStartInputSchema });
export const embodimentRuntimeExchangeInputSchema = z.strictObject({ actor: embodimentRuntimeActorSchema, call: embodimentCallExchangeInputSchema });
export const embodimentRuntimeEndInputSchema = z.strictObject({ actor: embodimentRuntimeActorSchema, call: embodimentCallEndInputSchema });
export const embodimentRuntimeTerminalStatusSchema = z.strictObject({ terminal_id: terminalIdSchema, connected: z.boolean(), call_id: z.string().min(1).max(64).nullable(), state: z.enum(["offline", "idle", "ringing", "connected", "playing", "waiting", "recording", "processing", "ended"]) });
export const embodimentRuntimeStatusResultSchema = z.strictObject({ status: z.enum(["idle", "degraded"]), active_calls: z.number().int().nonnegative(), connected_terminals: z.number().int().nonnegative(), now_ms: z.number().int().nonnegative() });
/** Internal-only: Backend joins authenticated Runtime connections with Company terminal records. */
export const embodimentRuntimeConnectedTerminalsResultSchema = z.strictObject({ items: z.array(z.strictObject({ terminal_id: terminalIdSchema })) });
export const embodimentRuntimeTerminalDisconnectResultSchema = z.strictObject({ disconnected: z.literal(true) });
export const embodimentRuntimeStartResultSchema = embodimentCallStartResultSchema;
export const embodimentRuntimeExchangeResultSchema = embodimentCallExchangeResultSchema;
export const embodimentRuntimeEndResultSchema = embodimentCallEndResultSchema;
export const embodimentRuntimeInternalErrorSchema = z.strictObject({ error: z.enum(["unauthorized", "invalid_request", "runtime_unavailable"]), retryable: z.boolean() });
