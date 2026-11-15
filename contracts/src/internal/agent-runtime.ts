import { z } from "zod";

import {
  agentTurnErrorSchema,
  agentTurnScopeSchema,
  agentTurnStatusSchema,
} from "../public/agent-activity.js";
import type { Turn as CodexTurn } from "../generated/codex-app-server-protocol/v2/Turn.js";

const codexTurnBoundarySchema = z.record(z.string(), z.unknown()) as unknown as z.ZodType<CodexTurn>;

export const codexAgentRuntimeExecutionSchema = z.strictObject({
  status: agentTurnStatusSchema,
  started_at_ms: z.number().int().nonnegative().nullable(),
  completed_at_ms: z.number().int().nonnegative().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  error: agentTurnErrorSchema.nullable(),
});
export type CodexAgentRuntimeExecution = z.infer<typeof codexAgentRuntimeExecutionSchema>;

export const codexAgentRuntimeSnapshotPayloadSchema = z.strictObject({
  execution: codexAgentRuntimeExecutionSchema,
  turn: codexTurnBoundarySchema.nullable(),
});
export type CodexAgentRuntimeSnapshotPayload = z.infer<typeof codexAgentRuntimeSnapshotPayloadSchema>;

export const codexAgentRuntimeSessionSnapshotPayloadSchema = z.strictObject({
  room_thread_id: z.string().min(1).nullable(),
  selected_turn_id: z.string().min(1).nullable(),
  turns: z.array(codexTurnBoundarySchema),
});
export type CodexAgentRuntimeSessionSnapshotPayload = z.infer<typeof codexAgentRuntimeSessionSnapshotPayloadSchema>;

const codexAgentRuntimeEnvelopeBaseShape = {
  schema_version: z.literal(1),
  event_id: z.string().min(1),
  provider: z.literal("codex"),
  source: z.literal("company-runtime"),
  scope: agentTurnScopeSchema,
  turn_id: z.string().min(1).nullable(),
  occurred_at_ms: z.number().int().nonnegative(),
};

export const codexAgentRuntimeSnapshotSchema = z.strictObject({
  ...codexAgentRuntimeEnvelopeBaseShape,
  type: z.literal("agent_runtime.snapshot"),
  method: z.literal("turn/snapshot"),
  item_id: z.null(),
  payload: codexAgentRuntimeSnapshotPayloadSchema,
});
export type CodexAgentRuntimeSnapshot = z.infer<typeof codexAgentRuntimeSnapshotSchema>;

export const codexAgentRuntimeEventSchema = z.strictObject({
  ...codexAgentRuntimeEnvelopeBaseShape,
  type: z.literal("agent_runtime.event"),
  method: z.string().min(1),
  item_id: z.string().min(1).nullable(),
  payload: z.unknown(),
});
export type CodexAgentRuntimeEvent = z.infer<typeof codexAgentRuntimeEventSchema>;

export const codexAgentRuntimeInteractionRequestMethodSchema = z.enum([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
  "item/tool/requestUserInput",
]);
export type CodexAgentRuntimeInteractionRequestMethod = z.infer<
  typeof codexAgentRuntimeInteractionRequestMethodSchema
>;

/**
 * A transient raw Codex JSON-RPC request crossing the Runtime-to-Backend
 * anti-corruption boundary. Backend must project and persist only the
 * provider-neutral interaction; `request_id` and `payload` stay in-flight.
 */
export const codexAgentRuntimeInteractionRequestSchema = z.strictObject({
  ...codexAgentRuntimeEnvelopeBaseShape,
  type: z.literal("agent_runtime.interaction_request"),
  method: codexAgentRuntimeInteractionRequestMethodSchema,
  request_id: z.union([z.string(), z.number()]),
  item_id: z.string().min(1).nullable(),
  payload: z.unknown(),
});
export type CodexAgentRuntimeInteractionRequest = z.infer<
  typeof codexAgentRuntimeInteractionRequestSchema
>;

export const codexAgentRuntimeSessionSnapshotSchema = z.strictObject({
  ...codexAgentRuntimeEnvelopeBaseShape,
  type: z.literal("agent_runtime.session_snapshot"),
  method: z.literal("thread/snapshot"),
  item_id: z.null(),
  payload: codexAgentRuntimeSessionSnapshotPayloadSchema,
});
export type CodexAgentRuntimeSessionSnapshot = z.infer<typeof codexAgentRuntimeSessionSnapshotSchema>;

export const codexAgentRuntimeEnvelopeSchema = z.discriminatedUnion("type", [
  codexAgentRuntimeSnapshotSchema,
  codexAgentRuntimeEventSchema,
  codexAgentRuntimeInteractionRequestSchema,
]);
export type CodexAgentRuntimeEnvelope = z.infer<typeof codexAgentRuntimeEnvelopeSchema>;

export const roomCodexAgentRuntimeEnvelopeSchema = codexAgentRuntimeEnvelopeSchema.superRefine((event, context) => {
  if (event.scope.type !== "room") {
    context.addIssue({
      code: "custom",
      path: ["scope", "type"],
      message: "Agent-Room Runtime activity requires a Room execution scope.",
    });
  }
});
export type RoomCodexAgentRuntimeEnvelope = z.infer<typeof roomCodexAgentRuntimeEnvelopeSchema>;

export const roomCodexAgentRuntimeActivityAcceptedSchema = z.strictObject({
  accepted: z.literal(true),
  event_id: z.string().min(1),
  duplicate: z.boolean(),
  interaction_id: z.string().min(1).nullable(),
});
export type RoomCodexAgentRuntimeActivityAccepted = z.infer<typeof roomCodexAgentRuntimeActivityAcceptedSchema>;

export const codexAgentRuntimeEventStreamSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable).transform(async function* (iter) {
  for await (const value of iter) {
    yield codexAgentRuntimeEnvelopeSchema.parse(value);
  }
});
export type CodexAgentRuntimeEventStream = z.infer<typeof codexAgentRuntimeEventStreamSchema>;

export const companyRuntimeCodexAgentSessionEventStreamSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable).transform(async function* (iter) {
  let first = true;
  for await (const value of iter) {
    const event = z.union([
      codexAgentRuntimeSessionSnapshotSchema,
      codexAgentRuntimeSnapshotSchema,
      codexAgentRuntimeEventSchema,
      codexAgentRuntimeInteractionRequestSchema,
    ]).parse(value);
    if (first && event.type !== "agent_runtime.session_snapshot") {
      throw new Error("Company Runtime Agent Session streams must start with an authoritative Session snapshot.");
    }
    first = false;
    yield event;
  }
  if (first) {
    throw new Error("Company Runtime Agent Session streams must contain an authoritative Session snapshot.");
  }
});
export type CompanyRuntimeCodexAgentSessionEventStream = z.infer<typeof companyRuntimeCodexAgentSessionEventStreamSchema>;

export const companyRuntimeCodexAgentEventStreamSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable).transform(async function* (iter) {
  for await (const value of iter) {
    const event = z.union([
      codexAgentRuntimeEventSchema,
      codexAgentRuntimeInteractionRequestSchema,
    ]).parse(value);
    yield event;
  }
});
export type CompanyRuntimeCodexAgentEventStream = z.infer<typeof companyRuntimeCodexAgentEventStreamSchema>;

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
