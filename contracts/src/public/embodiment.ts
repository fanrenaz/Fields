import { z } from "zod";

export {
  decodeS3auFrame,
  encodeS3auFrame,
  S3AU_FINAL_FLAG,
  S3AU_HEADER_LENGTH,
  S3AU_HEADER_TEST_VECTOR_HEX,
  S3AU_MAGIC,
  S3AU_MAX_PAYLOAD_BYTES,
  S3AU_VERSION,
  type S3auAudioFrame,
  type S3auFrameExpectation,
} from "./embodiment-audio.js";

/** The intentionally non-compatible Embodiment Terminal Protocol version. */
export const EMBODIMENT_SCHEMA_VERSION = 2 as const;
export const embodimentSchemaVersion = z.literal(EMBODIMENT_SCHEMA_VERSION);
export const operationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const callIdSchema = z.string().min(1).max(64);
export const turnIdSchema = z.string().min(1).max(64);
export const terminalIdSchema = z.string().min(1).max(128);
export const terminalTokenSchema = z.string().min(32).max(512);
export const terminalTokenVersionSchema = z.number().int().positive();

export const embodimentCallStartInputSchema = z.strictObject({
  operation_id: operationIdSchema,
  terminal_id: terminalIdSchema,
  caller_label: z.string().min(1).max(128),
  purpose: z.string().min(1).max(256).optional(),
});
export type EmbodimentCallStartInput = z.infer<typeof embodimentCallStartInputSchema>;
export const embodimentCallExchangeInputSchema = z.strictObject({
  operation_id: operationIdSchema,
  call_id: callIdSchema,
  spoken_text: z.string().min(1).max(16_384),
});
export type EmbodimentCallExchangeInput = z.infer<typeof embodimentCallExchangeInputSchema>;
export const embodimentCallEndInputSchema = z.strictObject({
  operation_id: operationIdSchema,
  call_id: callIdSchema,
  closing_text: z.string().min(1).max(16_384).optional(),
});
export type EmbodimentCallEndInput = z.infer<typeof embodimentCallEndInputSchema>;

export const callStateSchema = z.enum(["idle", "ringing", "connected", "ended"]);
export const callEndReasonSchema = z.enum(["agent_hangup", "human_hangup", "declined", "missed", "terminal_disconnected", "terminal_restarted", "controller_cancelled", "controller_timeout", "protocol_error", "internal_error"]);
export const exchangeReasonSchema = z.enum(["no_speech", "no_response", "human_hangup", "terminal_disconnected", "terminal_restarted", "controller_cancelled", "controller_timeout", "tts_error", "speech_too_long", "playback_error", "stt_error", "deadline_exceeded", "protocol_error", "internal_error"]);
export const embodimentCallToolErrorSchema = z.strictObject({
  code: z.enum(["invalid_argument", "operation_id_conflict", "unknown_call", "invalid_call_state", "operation_in_progress", "forbidden", "runtime_unavailable"]),
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type EmbodimentCallToolError = z.infer<typeof embodimentCallToolErrorSchema>;

const callResultBaseSchema = z.strictObject({ schema_version: embodimentSchemaVersion, operation_id: operationIdSchema, call_state: callStateSchema, call_active: z.boolean(), retryable: z.boolean() });
export const embodimentCallStartResultSchema = callResultBaseSchema.extend({
  ok: z.literal(true),
  status: z.enum(["answered", "declined", "missed", "offline", "busy", "failed"]),
  call_id: callIdSchema.nullable(),
  reason: z.enum(["declined", "missed", "terminal_offline", "terminal_busy", "terminal_disconnected", "controller_cancelled", "internal_error"]).nullable(),
});
export type EmbodimentCallStartResult = z.infer<typeof embodimentCallStartResultSchema>;
export const embodimentCallExchangeResultSchema = callResultBaseSchema.extend({
  ok: z.literal(true),
  status: z.enum(["replied", "no_speech", "no_response", "ended", "failed"]),
  call_id: callIdSchema,
  turn_id: turnIdSchema.nullable(),
  transcript: z.string().nullable(),
  reason: exchangeReasonSchema.nullable(),
});
export type EmbodimentCallExchangeResult = z.infer<typeof embodimentCallExchangeResultSchema>;
export const embodimentCallEndResultSchema = z.strictObject({
  schema_version: embodimentSchemaVersion,
  ok: z.literal(true),
  operation_id: operationIdSchema,
  status: z.enum(["ended", "already_ended"]),
  call_id: callIdSchema,
  call_state: z.literal("ended"),
  call_active: z.literal(false),
  retryable: z.literal(false),
  closing_played: z.boolean(),
  reason: callEndReasonSchema,
  warning: z.enum(["tts_error", "speech_too_long", "playback_error", "terminal_disconnected", "deadline_exceeded", "closing_skipped_active_exchange"]).nullable(),
});
export type EmbodimentCallEndResult = z.infer<typeof embodimentCallEndResultSchema>;
export const embodimentCallToolErrorResultSchema = z.strictObject({ schema_version: embodimentSchemaVersion, ok: z.literal(false), operation_id: operationIdSchema, error: embodimentCallToolErrorSchema });
export type EmbodimentCallToolErrorResult = z.infer<typeof embodimentCallToolErrorResultSchema>;
export const embodimentCallResultSchema = z.union([embodimentCallStartResultSchema, embodimentCallExchangeResultSchema, embodimentCallEndResultSchema, embodimentCallToolErrorResultSchema]);
export const embodimentCallMcpToolNameSchema = z.enum(["embodiment.call.start", "embodiment.call.exchange", "embodiment.call.end"]);
export type EmbodimentCallMcpToolName = z.infer<typeof embodimentCallMcpToolNameSchema>;
export const embodimentCallMcpToolInputs = {
  "embodiment.call.start": embodimentCallStartInputSchema,
  "embodiment.call.exchange": embodimentCallExchangeInputSchema,
  "embodiment.call.end": embodimentCallEndInputSchema,
} as const;

const terminalEventBase = { schema_version: embodimentSchemaVersion, event_id: z.string().min(1).max(128) } as const;
const streamIdSchema = z.number().int().min(1).max(0xffffffff);
export const terminalCapabilitiesSchema = z.strictObject({ audio_input: z.literal("pcm16le_16000_mono"), audio_output: z.literal("pcm16le_16000_mono"), max_audio_payload_bytes: z.literal(1024), display: z.boolean(), buttons: z.array(z.enum(["a", "b"])).min(1) });
export const terminalHelloSchema = z.strictObject({ ...terminalEventBase, type: z.literal("terminal.hello"), terminal_id: terminalIdSchema, boot_id: z.string().min(1).max(128), capabilities: terminalCapabilitiesSchema });
export const terminalReadySchema = z.strictObject({ ...terminalEventBase, type: z.literal("terminal.ready"), terminal_id: terminalIdSchema, connection_id: z.string().min(1).max(128), accepted_at_ms: z.number().int().nonnegative() });
/** Terminal confirms durable receipt of a rotated per-terminal credential. */
export const terminalCredentialsAckSchema = z.strictObject({ ...terminalEventBase, type: z.literal("terminal.credentials_ack"), terminal_id: terminalIdSchema, terminal_token_version: terminalTokenVersionSchema });
export const systemPingSchema = z.strictObject({ ...terminalEventBase, type: z.literal("system.ping"), sent_at_ms: z.number().int().nonnegative() });
export const systemPongSchema = z.strictObject({ ...terminalEventBase, type: z.literal("system.pong"), ping_event_id: z.string().min(1).max(128), sent_at_ms: z.number().int().nonnegative() });
export const terminalErrorSchema = z.strictObject({ ...terminalEventBase, type: z.literal("terminal.error"), terminal_id: terminalIdSchema, code: z.enum(["invalid_message", "unsupported_version", "unsupported_event", "invalid_state", "unknown_call", "unknown_turn", "invalid_audio_frame", "duplicate_connection", "credential_invalid", "internal_error"]), message: z.string().min(1).max(512), call_id: callIdSchema.nullable(), turn_id: turnIdSchema.nullable(), stream_id: streamIdSchema.nullable(), fatal: z.boolean() });
export const callIncomingSchema = z.strictObject({ ...terminalEventBase, type: z.literal("call.incoming"), terminal_id: terminalIdSchema, call_id: callIdSchema, caller_label: z.string().min(1).max(128), purpose: z.string().min(1).max(256).optional() });
export const callAnswerSchema = z.strictObject({ ...terminalEventBase, type: z.literal("call.answer"), terminal_id: terminalIdSchema, call_id: callIdSchema });
export const callDeclineSchema = z.strictObject({ ...terminalEventBase, type: z.literal("call.decline"), terminal_id: terminalIdSchema, call_id: callIdSchema });
export const callConnectedSchema = z.strictObject({ ...terminalEventBase, type: z.literal("call.connected"), terminal_id: terminalIdSchema, call_id: callIdSchema });
export const callHangupSchema = z.strictObject({ ...terminalEventBase, type: z.literal("call.hangup"), terminal_id: terminalIdSchema, call_id: callIdSchema });
export const callEndedSchema = z.strictObject({ ...terminalEventBase, type: z.literal("call.ended"), terminal_id: terminalIdSchema, call_id: callIdSchema, reason: callEndReasonSchema });
export const turnListenSchema = z.strictObject({ ...terminalEventBase, type: z.literal("turn.listen"), terminal_id: terminalIdSchema, call_id: callIdSchema, turn_id: turnIdSchema, response_deadline_ms: z.number().int().nonnegative() });
export const turnCompleteSchema = z.strictObject({ ...terminalEventBase, type: z.literal("turn.complete"), terminal_id: terminalIdSchema, call_id: callIdSchema, turn_id: turnIdSchema, outcome: z.enum(["replied", "no_speech", "no_response", "failed"]), reason: z.enum(["tts_error", "speech_too_long", "playback_error", "stt_error", "deadline_exceeded", "protocol_error", "internal_error"]).nullable() });
export const audioStartSchema = z.strictObject({ ...terminalEventBase, type: z.literal("audio.start"), terminal_id: terminalIdSchema, call_id: callIdSchema, turn_id: turnIdSchema, stream_id: streamIdSchema, direction: z.enum(["uplink", "downlink"]), sample_rate_hz: z.literal(16_000), bits_per_sample: z.literal(16), channels: z.literal(1) });
export const audioReadySchema = z.strictObject({ ...terminalEventBase, type: z.literal("audio.ready"), terminal_id: terminalIdSchema, call_id: callIdSchema, turn_id: turnIdSchema, stream_id: streamIdSchema, buffer_bytes: z.number().int().min(16_384) });
export const audioProgressSchema = z.strictObject({ ...terminalEventBase, type: z.literal("audio.progress"), terminal_id: terminalIdSchema, call_id: callIdSchema, turn_id: turnIdSchema, stream_id: streamIdSchema, received_seq: z.number().int().nonnegative() });
export const audioEndSchema = z.strictObject({ ...terminalEventBase, type: z.literal("audio.end"), terminal_id: terminalIdSchema, call_id: callIdSchema, turn_id: turnIdSchema, stream_id: streamIdSchema, frame_count: z.number().int().nonnegative(), total_bytes: z.number().int().nonnegative(), final_seq: z.number().int().nonnegative().nullable() });
export const audioPlayedSchema = z.strictObject({ ...terminalEventBase, type: z.literal("audio.played"), terminal_id: terminalIdSchema, call_id: callIdSchema, turn_id: turnIdSchema, stream_id: streamIdSchema, status: z.enum(["played", "failed"]) });
export const terminalJsonEventSchema = z.discriminatedUnion("type", [terminalHelloSchema, terminalReadySchema, terminalCredentialsAckSchema, systemPingSchema, systemPongSchema, terminalErrorSchema, callIncomingSchema, callAnswerSchema, callDeclineSchema, callConnectedSchema, callHangupSchema, callEndedSchema, turnListenSchema, turnCompleteSchema, audioStartSchema, audioReadySchema, audioProgressSchema, audioEndSchema, audioPlayedSchema]);
export type TerminalJsonEvent = z.infer<typeof terminalJsonEventSchema>;
export type TerminalHello = z.infer<typeof terminalHelloSchema>;
export type TerminalCapabilities = z.infer<typeof terminalCapabilitiesSchema>;

export const pairingCodeSchema = z.string().regex(/^[A-Z0-9]{6}$/);
export const pairingSessionIdSchema = z.string().min(16).max(128);
/** First unpaired frame: Runtime assigns the session id in pairing.code. */
export const pairingTerminalHelloSchema = z.strictObject({ schema_version: embodimentSchemaVersion, type: z.literal("pairing.hello"), label: z.string().min(1).max(128).optional() });
export const pairingCodeMessageSchema = z.strictObject({ schema_version: embodimentSchemaVersion, type: z.literal("pairing.code"), pairing_session_id: pairingSessionIdSchema, code: pairingCodeSchema, expires_at_ms: z.number().int().nonnegative() });
export const pairingCredentialsSchema = z.strictObject({ schema_version: embodimentSchemaVersion, type: z.literal("pairing.credentials"), terminal_id: terminalIdSchema, terminal_token: terminalTokenSchema, terminal_token_version: terminalTokenVersionSchema });
export const pairingInvalidSchema = z.strictObject({ schema_version: embodimentSchemaVersion, type: z.literal("pairing.invalid"), code: z.enum(["expired", "claimed", "credential_invalid", "revoked"]), message: z.string().min(1).max(256) });
export const pairingTerminalEventSchema = z.union([pairingTerminalHelloSchema]);
export const pairingServerEventSchema = z.union([pairingCodeMessageSchema, pairingCredentialsSchema, pairingInvalidSchema, systemPongSchema]);
export type PairingTerminalEvent = z.infer<typeof pairingTerminalEventSchema>;
export type PairingServerEvent = z.infer<typeof pairingServerEventSchema>;
export const pairingClaimInputSchema = z.strictObject({ code: pairingCodeSchema, label: z.string().min(1).max(128).optional() });

/** Browser-safe Company-owned terminal facts. Terminal credentials never enter this contract. */
export const companyTerminalBindingSchema = z.strictObject({ terminal_id: terminalIdSchema, label: z.string().min(1).max(128), status: z.literal("active"), paired_at_ms: z.number().int().nonnegative() });
export type CompanyTerminalBinding = z.infer<typeof companyTerminalBindingSchema>;
/** A best-effort projection of Terminal Runtime connectivity, not a Call activity feed. */
export const companyTerminalConnectionStatusSchema = z.enum(["online", "offline", "unknown"]);
export type CompanyTerminalConnectionStatus = z.infer<typeof companyTerminalConnectionStatusSchema>;
export const companyTerminalSummarySchema = companyTerminalBindingSchema.extend({ connection_status: companyTerminalConnectionStatusSchema });
export type CompanyTerminalSummary = z.infer<typeof companyTerminalSummarySchema>;
export const companyTerminalsListResultSchema = z.strictObject({ items: z.array(companyTerminalSummarySchema) });
export type CompanyTerminalsListResult = z.infer<typeof companyTerminalsListResultSchema>;
/** Failure shape for a runtime-authenticated terminal discovery request. */
export const embodimentTerminalListErrorSchema = z.strictObject({
  code: z.literal("runtime_identity_invalid"),
  message: z.string().min(1).max(256),
  retryable: z.literal(false),
});
export type EmbodimentTerminalListError = z.infer<typeof embodimentTerminalListErrorSchema>;
export const pairingClaimResultSchema = z.strictObject({ terminal: companyTerminalBindingSchema });
export type PairingClaimResult = z.infer<typeof pairingClaimResultSchema>;
export const companyTerminalRevokeResultSchema = z.strictObject({ terminal_id: terminalIdSchema });
export type CompanyTerminalRevokeResult = z.infer<typeof companyTerminalRevokeResultSchema>;
export const companyTerminalControlErrorSchema = z.strictObject({
  code: z.enum(["EMBODIMENT_TERMINAL_OWNER_REQUIRED", "EMBODIMENT_PAIRING_INVALID", "EMBODIMENT_PAIRING_NOT_FOUND", "EMBODIMENT_PAIRING_DELIVERY_FAILED", "EMBODIMENT_TERMINAL_INVALID", "EMBODIMENT_TERMINAL_NOT_FOUND", "EMBODIMENT_TERMINAL_RUNTIME_UNAVAILABLE", "EMBODIMENT_TERMINAL_ROTATION_DELIVERY_FAILED", "EMBODIMENT_TERMINAL_ROTATION_INVALID"]),
  message: z.string().min(1).max(256),
  retryable: z.boolean(),
});
export type CompanyTerminalControlError = z.infer<typeof companyTerminalControlErrorSchema>;
