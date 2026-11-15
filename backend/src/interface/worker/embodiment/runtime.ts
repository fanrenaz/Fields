import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type WebSocket from "ws";
import {
  EMBODIMENT_SCHEMA_VERSION,
  embodimentCallEndInputSchema,
  embodimentCallExchangeInputSchema,
  embodimentCallStartInputSchema,
  decodeS3auFrame,
  systemPingSchema,
  terminalCredentialsAckSchema,
  terminalHelloSchema,
  terminalJsonEventSchema,
  encodeS3auFrame,
  pairingTerminalHelloSchema,
  S3AU_FINAL_FLAG,
} from "@fields/contracts/public/embodiment";
import {
  embodimentRuntimeEndInputSchema,
  embodimentRuntimeExchangeInputSchema,
  embodimentRuntimeStartInputSchema,
} from "@fields/contracts/internal/embodiment-runtime";
import type { EmbodimentSpeechPort, InternalControlAuthorizationPort } from "../../../application/embodiment/ports.js";
import { emitObservabilityLog } from "../../../observability/events.js";

type TerminalConnection = { socket: WebSocket; terminalId: string; bootId: string; callId: string | null; waiters: Set<(event: TerminalEvent) => void>; audio: Map<string, Uint8Array[]>; uplinkStreams: Map<string, string> };
type TerminalEvent = { type: string; [key: string]: unknown };
type PairingConnection = { socket: WebSocket; acknowledgements: Set<(event: { terminal_id: string; terminal_token_version: number }) => void> };
type CallRecord = { callId: string; terminalId: string; actorId: string; companyId: string; state: "ringing" | "connected" | "ended"; terminal: TerminalConnection; finalized: boolean };

export type EmbodimentRuntimeOptions = { host?: string; port?: number; backendUrl?: string; controlTokenFile?: string; internalAuthorization?: InternalControlAuthorizationPort; speech?: EmbodimentSpeechPort; logger?: boolean };
export type EmbodimentRuntime = { app: FastifyInstance; start(): Promise<void>; stop(): Promise<void>; };

export function createEmbodimentRuntime(options: EmbodimentRuntimeOptions = {}): EmbodimentRuntime {
  const app = Fastify({ logger: options.logger ?? false });
  const tokenFile = options.controlTokenFile ?? process.env.FIELDS_INTERNAL_CONTROL_TOKEN_FILE ?? "";
  const backendUrl = (options.backendUrl ?? process.env.FIELDS_BACKEND_EMBODIMENT_API_URL ?? "http://127.0.0.1:4102").replace(/\/$/u, "");
  const internalAuthorization = options.internalAuthorization ?? { matches: async () => false };
  const speech = options.speech ?? unavailableSpeech;
  const terminals = new Map<string, TerminalConnection>();
  const calls = new Map<string, CallRecord>();
  const operations = new Map<string, { input: string; promise: Promise<unknown> }>();
  const pairingSockets = new Map<string, PairingConnection>();
  const pairingReconnectConfirmations = new Map<string, Set<() => void>>();

  async function internal(request: { headers: { authorization?: string | string[] | undefined } }, reply: { code(status: number): { send(body: unknown): unknown } }): Promise<boolean> {
    if (await internalAuthorization.matches(request.headers.authorization)) return true;
    reply.code(401).send({ error: "unauthorized", retryable: false }); return false;
  }
  async function backend(path: string, body: unknown): Promise<Record<string, unknown> | null> {
    let token = "";
    try { token = (await readFile(tokenFile, "utf8")).trim(); } catch { return null; }
    const response = await fetch(`${backendUrl}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) return null;
    const payload = await response.json() as unknown;
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  }

  app.get("/health", async () => ({ ok: true, service: "fields-embodiment-runtime" }));
  app.get("/internal/embodiment/status", async (request, reply) => {
    if (!(await internal(request, reply))) return;
    return { status: "idle", active_calls: [...calls.values()].filter((call) => !call.finalized).length, connected_terminals: terminals.size, now_ms: Date.now() };
  });
  app.get("/internal/embodiment/terminals/status", async (request, reply) => {
    if (!(await internal(request, reply))) return;
    return { items: [...terminals.keys()].sort().map((terminal_id) => ({ terminal_id })) };
  });
  app.post("/internal/embodiment/call/start", async (request, reply) => {
    if (!(await internal(request, reply))) return;
    const parsed = embodimentRuntimeStartInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", retryable: false });
    return start(parsed.data.actor, parsed.data.call);
  });
  app.post("/internal/embodiment/call/exchange", async (request, reply) => {
    if (!(await internal(request, reply))) return;
    const parsed = embodimentRuntimeExchangeInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", retryable: false });
    return exchange(parsed.data.actor, parsed.data.call);
  });
  app.post("/internal/embodiment/call/end", async (request, reply) => {
    if (!(await internal(request, reply))) return;
    const parsed = embodimentRuntimeEndInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", retryable: false });
    return end(parsed.data.actor, parsed.data.call);
  });
  app.post("/internal/embodiment/pairing/credentials", async (request, reply) => {
    if (!(await internal(request, reply))) return;
    const body = request.body as { pairing_session_id?: unknown; terminal_id?: unknown; terminal_token?: unknown; terminal_token_version?: unknown };
    if (typeof body?.pairing_session_id !== "string" || typeof body.terminal_id !== "string" || typeof body.terminal_token !== "string" || typeof body.terminal_token_version !== "number" || !Number.isInteger(body.terminal_token_version)) return reply.code(400).send({ error: "invalid_request", retryable: false });
    const pairingConnection = pairingSockets.get(body.pairing_session_id);
    if (pairingConnection && pairingConnection.socket.readyState === pairingConnection.socket.OPEN) {
      pairingLog("credentials_sent", { token_version: body.terminal_token_version });
      const acknowledgement = waitForPairingAck(pairingConnection, body.terminal_id, body.terminal_token_version, 10_000);
      pairingConnection.socket.send(JSON.stringify({ schema_version: EMBODIMENT_SCHEMA_VERSION, type: "pairing.credentials", terminal_id: body.terminal_id, terminal_token: body.terminal_token, terminal_token_version: body.terminal_token_version }));
      const confirmed = await acknowledgement;
      pairingLog(confirmed ? "credentials_confirmed" : "credentials_confirmation_timeout", { token_version: body.terminal_token_version });
      if (confirmed) pairingSockets.delete(body.pairing_session_id);
      return { delivered: true, confirmed };
    }
    if (body.pairing_session_id === `terminal:${body.terminal_id}`) {
      const terminal = terminals.get(body.terminal_id);
      if (!terminal) return reply.code(409).send({ error: "terminal_not_connected", retryable: true });
      sendPairingCredentials(terminal, body.terminal_id, body.terminal_token, body.terminal_token_version);
      const acknowledgement = await waitFor(terminal, (event) => event.type === "terminal.credentials_ack" && event.terminal_id === body.terminal_id && event.terminal_token_version === body.terminal_token_version, 10_000);
      return { delivered: acknowledgement !== null, confirmed: acknowledgement !== null };
    }
    pairingLog("credentials_socket_missing");
    return reply.code(409).send({ error: "pairing_not_connected", retryable: true });
  });
  app.post("/internal/embodiment/terminal/disconnect", async (request, reply) => {
    if (!(await internal(request, reply))) return;
    const terminalId = (request.body as { terminal_id?: unknown })?.terminal_id;
    if (typeof terminalId !== "string") return reply.code(400).send({ error: "invalid_request", retryable: false });
    const socket = terminals.get(terminalId)?.socket;
    if (!socket) return { disconnected: true };
    if (socket.readyState === socket.OPEN) {
      // Do not rely on a WebSocket close reason reaching every terminal
      // transport. The shared firmware/PC core consumes this protocol event,
      // clears the persisted credential, and reconnects in pairing mode.
      socket.send(JSON.stringify({
        schema_version: EMBODIMENT_SCHEMA_VERSION,
        type: "pairing.invalid",
        code: "revoked",
        message: "Terminal credentials were revoked.",
      }));
      socket.close(1008, "credential revoked");
    }
    return { disconnected: true };
  });

  void app.register(websocket).after(() => {
    app.get("/embodiment/ws", { websocket: true }, (socket, request) => {
      const idHeader = request.headers["x-terminal-id"];
      const tokenHeader = request.headers["x-terminal-token"];
      const terminalId = Array.isArray(idHeader) ? idHeader[0] : idHeader;
      const terminalToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
      if (!terminalId || !terminalToken) { attachPairing(socket as unknown as WebSocket); return; }
      const buffered: Array<readonly [raw: WebSocket.RawData, isBinary: boolean]> = [];
      const bufferMessage = (raw: WebSocket.RawData, isBinary: boolean) => buffered.push([raw, isBinary]);
      (socket as unknown as WebSocket).on("message", bufferMessage);
      void backend("/api/v1/internal/embodiment/terminals/authenticate", { terminal_id: terminalId, terminal_token: terminalToken }).then((result) => {
        (socket as unknown as WebSocket).off("message", bufferMessage);
        if (!result || result.authenticated !== true) {
          socket.send(JSON.stringify({ schema_version: EMBODIMENT_SCHEMA_VERSION, type: "pairing.invalid", code: "credential_invalid", message: "Terminal credentials are no longer valid." }));
          socket.close(1008, "credential invalid");
          return;
        }
        attachTerminal(socket as unknown as WebSocket, terminalId, buffered);
      });
    });
  });

  function attachPairing(socket: WebSocket): void {
    let sessionId: string | null = null;
    const connection: PairingConnection = { socket, acknowledgements: new Set() };
    socket.on("message", (raw) => {
      try {
        if (!sessionId) {
          const hello = pairingTerminalHelloSchema.safeParse(JSON.parse(String(raw)) as unknown);
          if (!hello.success) throw new Error("invalid");
          const label = hello.data.label;
          void backend("/api/v1/internal/embodiment/pairing/open", { label }).then((result) => {
            if (!result || typeof result.pairing_session_id !== "string" || typeof result.code !== "string" || typeof result.expires_at_ms !== "number") { socket.close(1011, "pairing unavailable"); return; }
            sessionId = result.pairing_session_id; pairingSockets.set(sessionId, connection);
            socket.send(JSON.stringify({ schema_version: EMBODIMENT_SCHEMA_VERSION, type: "pairing.code", pairing_session_id: sessionId, code: result.code, expires_at_ms: result.expires_at_ms }));
          });
          return;
        }
        const event = JSON.parse(String(raw)) as unknown;
        const ping = systemPingSchema.safeParse(event);
        if (ping.success) {
          socket.send(JSON.stringify({ schema_version: EMBODIMENT_SCHEMA_VERSION, event_id: `event_${randomUUID()}`, type: "system.pong", ping_event_id: ping.data.event_id, sent_at_ms: Date.now() }));
          return;
        }
        const acknowledgement = terminalCredentialsAckSchema.safeParse(event);
        if (!acknowledgement.success) throw new Error("invalid");
        pairingLog("credentials_ack_received", { token_version: acknowledgement.data.terminal_token_version });
        for (const acknowledge of connection.acknowledgements) acknowledge({ terminal_id: acknowledgement.data.terminal_id, terminal_token_version: acknowledgement.data.terminal_token_version });
      } catch { socket.close(1008, "pairing hello required"); }
    });
    socket.on("close", (code) => { if (sessionId) { pairingLog("pairing_socket_closed", { code }); pairingSockets.delete(sessionId); } });
  }

  function attachTerminal(socket: WebSocket, terminalId: string, initialMessages: readonly (readonly [raw: WebSocket.RawData, isBinary: boolean])[] = []): void {
    let connection: TerminalConnection | null = null;
    const helloTimer = setTimeout(() => socket.close(1008, "terminal hello required"), 5_000);
    const onMessage = (raw: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) { if (connection) receiveAudio(connection, raw as Buffer); return; }
      let event: TerminalEvent;
      try { event = terminalJsonEventSchema.parse(JSON.parse(String(raw))) as TerminalEvent; } catch { socket.close(1008, "invalid terminal event"); return; }
      if (!connection) {
        const hello = terminalHelloSchema.safeParse(event);
        if (!hello.success || hello.data.terminal_id !== terminalId) { socket.close(1008, "terminal hello required"); return; }
        clearTimeout(helloTimer);
        terminals.get(terminalId)?.socket.close(1008, "duplicate connection");
        connection = { socket, terminalId, bootId: hello.data.boot_id, callId: null, waiters: new Set(), audio: new Map(), uplinkStreams: new Map() };
        terminals.set(terminalId, connection);
        confirmPairingReconnect(terminalId);
        send(connection, { type: "terminal.ready", terminal_id: terminalId, connection_id: `connection_${randomUUID()}`, accepted_at_ms: Date.now() });
        return;
      }
      receiveEvent(connection, event);
    };
    socket.on("message", onMessage);
    for (const [raw, isBinary] of initialMessages) onMessage(raw, isBinary);
    socket.on("close", () => { clearTimeout(helloTimer); if (!connection) return; if (terminals.get(terminalId) === connection) terminals.delete(terminalId); if (connection.callId) void finalize(calls.get(connection.callId), "terminal_disconnected"); });
  }

  function receiveEvent(connection: TerminalConnection, event: TerminalEvent): void { if (event.type === "audio.start" && event.direction === "uplink" && typeof event.call_id === "string" && typeof event.turn_id === "string" && typeof event.stream_id === "number") connection.uplinkStreams.set(`${event.call_id}:${event.turn_id}`, String(event.stream_id)); for (const waiter of connection.waiters) waiter(event); if (event.type === "call.hangup" || event.type === "call.ended") { const call = typeof event.call_id === "string" ? calls.get(event.call_id) : undefined; void finalize(call, event.type === "call.hangup" ? "human_hangup" : "terminal_disconnected"); } }
  function receiveAudio(connection: TerminalConnection, raw: Buffer): void { try { const frame = decodeS3auFrame(new Uint8Array(raw)); const chunks = connection.audio.get(String(frame.stream_id)) ?? []; chunks.push(frame.payload); connection.audio.set(String(frame.stream_id), chunks); } catch { socketError(connection, "invalid_audio_frame"); } }
  function send(connection: TerminalConnection, event: Record<string, unknown>): void { if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(JSON.stringify({ schema_version: EMBODIMENT_SCHEMA_VERSION, event_id: `event_${randomUUID()}`, ...event })); }
  function sendPairingCredentials(connection: TerminalConnection, terminalId: string, terminalToken: string, terminalTokenVersion: number): void { if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(JSON.stringify({ schema_version: EMBODIMENT_SCHEMA_VERSION, type: "pairing.credentials", terminal_id: terminalId, terminal_token: terminalToken, terminal_token_version: terminalTokenVersion })); }
  function socketError(connection: TerminalConnection, code: string): void { send(connection, { type: "terminal.error", terminal_id: connection.terminalId, code, message: "Invalid audio frame.", call_id: connection.callId, turn_id: null, stream_id: null, fatal: false }); }
  function waitForPairingAck(connection: PairingConnection, terminalId: string, terminalTokenVersion: number, timeoutMs: number): Promise<boolean> { return new Promise((resolve) => { const timer = setTimeout(() => done(false), timeoutMs); const acknowledge = (event: { terminal_id: string; terminal_token_version: number }) => { if (event.terminal_id === terminalId && event.terminal_token_version === terminalTokenVersion) done(true); }; const reconnect = () => done(true); const confirmations = pairingReconnectConfirmations.get(terminalId) ?? new Set<() => void>(); confirmations.add(reconnect); pairingReconnectConfirmations.set(terminalId, confirmations); const done = (confirmed: boolean) => { clearTimeout(timer); connection.acknowledgements.delete(acknowledge); confirmations.delete(reconnect); if (confirmations.size === 0) pairingReconnectConfirmations.delete(terminalId); resolve(confirmed); }; connection.acknowledgements.add(acknowledge); }); }
  function confirmPairingReconnect(terminalId: string): void { const confirmations = pairingReconnectConfirmations.get(terminalId); if (!confirmations || confirmations.size === 0) return; pairingLog("credential_reconnect_confirmed"); for (const confirm of confirmations) confirm(); }
  function pairingLog(event: string, _fields: Record<string, boolean | number> = {}): void {
    emitObservabilityLog("embodiment.pairing", { code: event, retryable: false });
  }
  function waitFor(connection: TerminalConnection, predicate: (event: TerminalEvent) => boolean, timeoutMs: number): Promise<TerminalEvent | null> { return new Promise((resolve) => { const timer = setTimeout(() => done(null), timeoutMs); const listener = (event: TerminalEvent) => { if (predicate(event)) done(event); }; const done = (event: TerminalEvent | null) => { clearTimeout(timer); connection.waiters.delete(listener); resolve(event); }; connection.waiters.add(listener); }); }
  function idempotent<T>(actorId: string, tool: string, operationId: string, input: unknown, operation: () => Promise<T>): Promise<T> {
    const key = `${actorId}:${tool}:${operationId}`; const serial = JSON.stringify(input); const prior = operations.get(key);
    if (prior) { if (prior.input !== serial) return Promise.reject(toolError(operationId, "operation_id_conflict", false)); return prior.promise as Promise<T>; }
    const promise = operation().catch((error: unknown) => { operations.delete(key); throw error; });
    operations.set(key, { input: serial, promise }); return promise;
  }

  async function start(actor: { actor_id: string; company_id: string }, raw: unknown): Promise<unknown> {
    const input = embodimentCallStartInputSchema.parse(raw);
    return idempotent(actor.actor_id, "embodiment.call.start", input.operation_id, input, async () => {
      const terminal = terminals.get(input.terminal_id);
      if (!terminal) return startResult(input.operation_id, "offline", null, "terminal_offline");
      if (terminal.callId) return startResult(input.operation_id, "busy", null, "terminal_busy");
      const call: CallRecord = { callId: `call_${randomUUID()}`, terminalId: input.terminal_id, actorId: actor.actor_id, companyId: actor.company_id, state: "ringing", terminal, finalized: false };
      calls.set(call.callId, call); terminal.callId = call.callId;
      send(terminal, { type: "call.incoming", terminal_id: call.terminalId, call_id: call.callId, caller_label: input.caller_label, ...(input.purpose ? { purpose: input.purpose } : {}) });
      const answer = await waitFor(terminal, (event) => (event.type === "call.answer" || event.type === "call.decline") && event.call_id === call.callId, 30_000);
      if (answer?.type === "call.answer") { call.state = "connected"; send(terminal, { type: "call.connected", terminal_id: call.terminalId, call_id: call.callId }); return startResult(input.operation_id, "answered", call.callId, null); }
      await finalize(call, answer?.type === "call.decline" ? "declined" : "missed"); return startResult(input.operation_id, answer?.type === "call.decline" ? "declined" : "missed", null, answer?.type === "call.decline" ? "declined" : "missed");
    });
  }
  async function exchange(actor: { actor_id: string }, raw: unknown): Promise<unknown> {
    const input = embodimentCallExchangeInputSchema.parse(raw);
    return idempotent(actor.actor_id, "embodiment.call.exchange", input.operation_id, input, async () => {
      const call = calls.get(input.call_id); if (!call) throw toolError(input.operation_id, "unknown_call", false); if (call.actorId !== actor.actor_id) throw toolError(input.operation_id, "forbidden", false); if (call.finalized || call.state !== "connected") throw toolError(input.operation_id, "invalid_call_state", false);
      const turnId = `turn_${randomUUID()}`; let pcm: Uint8Array; try { pcm = await speech.synthesize(input.spoken_text); } catch { return exchangeResult(input.operation_id, call, "failed", turnId, null, "tts_error"); }
      if (pcm.byteLength === 0) return exchangeResult(input.operation_id, call, "failed", turnId, null, "tts_error");
      if (pcm.byteLength > 1_920_000) return exchangeResult(input.operation_id, call, "failed", turnId, null, "speech_too_long");
      const streamId = Math.floor(Math.random() * 0xffffffff) || 1; send(call.terminal, { type: "audio.start", terminal_id: call.terminalId, call_id: call.callId, turn_id: turnId, stream_id: streamId, direction: "downlink", sample_rate_hz: 16_000, bits_per_sample: 16, channels: 1 });
      let seq = 0; for (let offset = 0; offset < pcm.byteLength; offset += 1024) { const payload = pcm.slice(offset, Math.min(offset + 1024, pcm.byteLength)); call.terminal.socket.send(encodeS3auFrame({ flags: offset + payload.byteLength >= pcm.byteLength ? S3AU_FINAL_FLAG : 0, stream_id: streamId, seq, payload })); seq += 1; }
      send(call.terminal, { type: "audio.end", terminal_id: call.terminalId, call_id: call.callId, turn_id: turnId, stream_id: streamId, frame_count: seq, total_bytes: pcm.byteLength, final_seq: seq > 0 ? seq - 1 : null });
      const played = await waitFor(call.terminal, (event) => event.type === "audio.played" && event.call_id === call.callId && event.turn_id === turnId && event.stream_id === streamId, 60_000);
      if (!played || played.status !== "played") return exchangeResult(input.operation_id, call, "failed", turnId, null, "playback_error");
      send(call.terminal, { type: "turn.listen", terminal_id: call.terminalId, call_id: call.callId, turn_id: turnId, response_deadline_ms: Date.now() + 60_000 });
      const complete = await waitFor(call.terminal, (event) => event.type === "turn.complete" && event.call_id === call.callId && event.turn_id === turnId, 60_000);
      if (!complete) return exchangeResult(input.operation_id, call, "no_response", turnId, null, "no_response");
      const stream = call.terminal.uplinkStreams.get(`${call.callId}:${turnId}`); const audio = stream === undefined ? new Uint8Array() : concat(call.terminal.audio.get(stream) ?? []); const transcript = await speech.transcribe(audio).catch(() => null);
      if (complete.outcome === "no_speech") return exchangeResult(input.operation_id, call, "no_speech", turnId, null, "no_speech");
      return exchangeResult(input.operation_id, call, complete.outcome === "replied" ? "replied" : "failed", turnId, transcript, complete.outcome === "replied" ? null : "stt_error");
    });
  }
  async function end(actor: { actor_id: string }, raw: unknown): Promise<unknown> { const input = embodimentCallEndInputSchema.parse(raw); return idempotent(actor.actor_id, "embodiment.call.end", input.operation_id, input, async () => { const call = calls.get(input.call_id); if (!call) return endResult(input.operation_id, input.call_id, "already_ended", "agent_hangup", false, null); if (call.actorId !== actor.actor_id) throw toolError(input.operation_id, "forbidden", false); let closingPlayed = false; let warning: string | null = null; if (input.closing_text) { try { const pcm = await speech.synthesize(input.closing_text); closingPlayed = await playPcm(call, `turn_${randomUUID()}`, pcm); if (!closingPlayed) warning = "playback_error"; } catch { warning = "tts_error"; } } await finalize(call, "agent_hangup"); return endResult(input.operation_id, call.callId, "ended", "agent_hangup", closingPlayed, warning); }); }
  async function finalize(call: CallRecord | undefined, reason: string): Promise<void> { if (!call || call.finalized) return; call.finalized = true; call.state = "ended"; calls.delete(call.callId); if (call.terminal.callId === call.callId) call.terminal.callId = null; send(call.terminal, { type: "call.ended", terminal_id: call.terminalId, call_id: call.callId, reason }); }
  function startResult(operationId: string, status: string, callId: string | null, reason: string | null) { return { schema_version: EMBODIMENT_SCHEMA_VERSION, ok: true, operation_id: operationId, status, call_id: callId, reason, call_state: callId ? "connected" : "ended", call_active: callId !== null, retryable: false }; }
  function exchangeResult(operationId: string, call: CallRecord, status: string, turnId: string, transcript: string | null, reason: string | null) { return { schema_version: EMBODIMENT_SCHEMA_VERSION, ok: true, operation_id: operationId, status, call_id: call.callId, turn_id: turnId, transcript, reason, call_state: call.finalized ? "ended" : "connected", call_active: !call.finalized, retryable: false }; }
  async function playPcm(call: CallRecord, turnId: string, pcm: Uint8Array): Promise<boolean> { if (pcm.byteLength === 0) return false; const streamId = Math.floor(Math.random() * 0xffffffff) || 1; send(call.terminal, { type: "audio.start", terminal_id: call.terminalId, call_id: call.callId, turn_id: turnId, stream_id: streamId, direction: "downlink", sample_rate_hz: 16_000, bits_per_sample: 16, channels: 1 }); let seq = 0; for (let offset = 0; offset < pcm.byteLength; offset += 1024) { const payload = pcm.slice(offset, Math.min(offset + 1024, pcm.byteLength)); call.terminal.socket.send(encodeS3auFrame({ flags: offset + payload.byteLength >= pcm.byteLength ? S3AU_FINAL_FLAG : 0, stream_id: streamId, seq, payload })); seq += 1; } send(call.terminal, { type: "audio.end", terminal_id: call.terminalId, call_id: call.callId, turn_id: turnId, stream_id: streamId, frame_count: seq, total_bytes: pcm.byteLength, final_seq: seq > 0 ? seq - 1 : null }); const played = await waitFor(call.terminal, (event) => event.type === "audio.played" && event.call_id === call.callId && event.turn_id === turnId && event.stream_id === streamId, 60_000); return played?.status === "played"; }
  function endResult(operationId: string, callId: string, status: string, reason: string, closingPlayed: boolean, warning: string | null) { return { schema_version: EMBODIMENT_SCHEMA_VERSION, ok: true, operation_id: operationId, status, call_id: callId, call_state: "ended", call_active: false, retryable: false, closing_played: closingPlayed, reason, warning }; }
  function toolError(operationId: string, code: string, retryable: boolean) { return { schema_version: EMBODIMENT_SCHEMA_VERSION, ok: false, operation_id: operationId, error: { code, message: "Embodiment Call operation cannot be completed.", retryable } }; }
  let listening = false;
  return { app, async start() { if (listening) return; await app.ready(); await app.listen({ host: options.host ?? process.env.FIELDS_EMBODIMENT_HOST ?? "0.0.0.0", port: Number(options.port ?? process.env.FIELDS_EMBODIMENT_PORT ?? 4105) }); listening = true; }, async stop() { await app.close(); listening = false; } };
}

function concat(parts: Uint8Array[]): Uint8Array { const length = parts.reduce((total, item) => total + item.byteLength, 0); const output = new Uint8Array(length); let offset = 0; for (const item of parts) { output.set(item, offset); offset += item.byteLength; } return output; }

const unavailableSpeech: EmbodimentSpeechPort = {
  async synthesize(): Promise<Uint8Array> { throw new Error("No Embodiment speech provider is configured."); },
  async transcribe(): Promise<string | null> { throw new Error("No Embodiment speech provider is configured."); },
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { const runtime = createEmbodimentRuntime(); await runtime.start(); process.once("SIGINT", () => { void runtime.stop(); }); process.once("SIGTERM", () => { void runtime.stop(); }); }
