import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Fastify from "fastify";
import WebSocket from "ws";

import { decodeS3auFrame, encodeS3auFrame, type S3auAudioFrame } from "@fields/contracts/public/embodiment";

import { createEmbodimentRuntime } from "../../../../../src/interface/worker/embodiment/runtime.js";

const TEST_CONTROL = { matches: async (authorization: string | string[] | undefined) => authorization === "Bearer test-control-token" };
const TEST_DOWNLINK_PCM = new Uint8Array(34_560);
const TEST_SPEECH = {
  async synthesize(): Promise<Uint8Array> { return TEST_DOWNLINK_PCM; },
  async transcribe(): Promise<string> { return "收到"; },
};

test("Runtime correlates an uplink stream for transcript and confirms closing playback", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fields-call-runtime-"));
  const tokenFile = join(directory, "control-token");
  await writeFile(tokenFile, "test-control-token\n");
  const backend = Fastify();
  backend.post("/api/v1/internal/embodiment/terminals/authenticate", async () => ({ authenticated: true }));
  await backend.listen({ host: "127.0.0.1", port: 0 });
  const backendPort = (backend.server.address() as { port: number }).port;
  const runtime = createEmbodimentRuntime({ host: "127.0.0.1", port: 0, backendUrl: `http://127.0.0.1:${backendPort}`, controlTokenFile: tokenFile, internalAuthorization: TEST_CONTROL, speech: TEST_SPEECH, logger: false });
  await runtime.start();
  const runtimePort = (runtime.app.server.address() as { port: number }).port;
  assert.equal((await fetch(`http://127.0.0.1:${runtimePort}/device/ws`)).status, 404);
  const socket = new WebSocket(`ws://127.0.0.1:${runtimePort}/embodiment/ws`, { headers: { "x-terminal-id": "terminal_one", "x-terminal-token": "t".repeat(32) } });
  let callId = "";
  let closingPlayback = false;
  const downlinkFrames: S3auAudioFrame[] = [];
  const downlinkEnds: Array<{ streamId: number; frameCount: number; totalBytes: number; finalSeq: number | null }> = [];
  socket.on("message", (data, binary) => {
    if (binary) {
      downlinkFrames.push(decodeS3auFrame(rawBytes(data)));
      return;
    }
    const event = JSON.parse(String(data)) as Record<string, unknown>;
    if (event.type === "call.incoming") {
      callId = String(event.call_id);
      socket.send(terminalEvent("call.answer", { terminal_id: "terminal_one", call_id: callId }));
    }
    if (event.type === "pairing.credentials") {
      socket.send(terminalEvent("terminal.credentials_ack", { terminal_id: "terminal_one", terminal_token_version: Number(event.terminal_token_version) }));
    }
    if (event.type === "audio.end") {
      downlinkEnds.push({ streamId: Number(event.stream_id), frameCount: Number(event.frame_count), totalBytes: Number(event.total_bytes), finalSeq: event.final_seq === null ? null : Number(event.final_seq) });
      socket.send(terminalEvent("audio.played", { terminal_id: "terminal_one", call_id: String(event.call_id), turn_id: String(event.turn_id), stream_id: Number(event.stream_id), status: "played" }));
    }
    if (event.type === "turn.listen") {
      const turnId = String(event.turn_id);
      socket.send(terminalEvent("audio.start", { terminal_id: "terminal_one", call_id: callId, turn_id: turnId, stream_id: 7, direction: "uplink", sample_rate_hz: 16_000, bits_per_sample: 16, channels: 1 }));
      socket.send(encodeS3auFrame({ flags: 1, stream_id: 7, seq: 0, payload: new Uint8Array([0, 0]) }));
      socket.send(terminalEvent("turn.complete", { terminal_id: "terminal_one", call_id: callId, turn_id: turnId, outcome: "replied", reason: null }));
    }
    if (event.type === "call.ended") closingPlayback = true;
  });
  await once(socket, "open");
  socket.send(terminalEvent("terminal.hello", { terminal_id: "terminal_one", boot_id: "boot_one", capabilities: { audio_input: "pcm16le_16000_mono", audio_output: "pcm16le_16000_mono", max_audio_payload_bytes: 1024, display: true, buttons: ["a"] } }));
  await waitForMessage(socket, "terminal.ready");

  try {
    const connected = await internalGet(runtimePort, tokenFile, "/internal/embodiment/terminals/status");
    assert.deepEqual(connected, { items: [{ terminal_id: "terminal_one" }] });
    const rotation = await internal(runtimePort, tokenFile, "/internal/embodiment/pairing/credentials", { pairing_session_id: "terminal:terminal_one", terminal_id: "terminal_one", terminal_token: "r".repeat(32), terminal_token_version: 2 });
    assert.deepEqual(rotation, { delivered: true, confirmed: true });
    const start = await internal(runtimePort, tokenFile, "/internal/embodiment/call/start", { actor: { actor_id: "actor_one", company_id: "company_one" }, call: { operation_id: "start-1", terminal_id: "terminal_one", caller_label: "Agent" } });
    assert.equal(start.status, "answered");
    callId = String(start.call_id);
    const exchange = await internal(runtimePort, tokenFile, "/internal/embodiment/call/exchange", { actor: { actor_id: "actor_one", company_id: "company_one" }, call: { operation_id: "exchange-1", call_id: callId, spoken_text: "hello" } });
    assert.equal(exchange.status, "replied");
    assert.equal(exchange.transcript, "收到");
    const end = await internal(runtimePort, tokenFile, "/internal/embodiment/call/end", { actor: { actor_id: "actor_one", company_id: "company_one" }, call: { operation_id: "end-1", call_id: callId, closing_text: "bye" } });
    assert.equal(end.closing_played, true);
    assert.equal(end.warning, null);
    assert.equal(closingPlayback, true);
    assertShortFinalDownlink(downlinkFrames, downlinkEnds);
    const revokedMessage = waitForJson(socket, (event) => event.type === "pairing.invalid");
    assert.deepEqual(
      await internal(runtimePort, tokenFile, "/internal/embodiment/terminal/disconnect", { terminal_id: "terminal_one" }),
      { disconnected: true },
    );
    const revoked = await revokedMessage;
    assert.equal(revoked.code, "revoked");
    assert.equal(revoked.message, "Terminal credentials were revoked.");
  } catch (error) {
    context.diagnostic(error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error));
    throw error;
  } finally {
    socket.close();
    await runtime.stop();
    await backend.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Runtime confirms a persisted initial credential before pairing succeeds and signals invalid stored credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fields-call-runtime-pairing-"));
  const tokenFile = join(directory, "control-token");
  await writeFile(tokenFile, "test-control-token\n");
  let reconnectedToken = "";
  const backend = Fastify();
  backend.post("/api/v1/internal/embodiment/pairing/open", async () => ({ pairing_session_id: "pairing_session_123", code: "A1B2C3", expires_at_ms: Date.now() + 600_000 }));
  backend.post("/api/v1/internal/embodiment/terminals/authenticate", async (request) => ({ authenticated: (request.body as { terminal_token?: unknown }).terminal_token === "good-token" || (request.body as { terminal_token?: unknown }).terminal_token === reconnectedToken }));
  await backend.listen({ host: "127.0.0.1", port: 0 });
  const backendPort = (backend.server.address() as { port: number }).port;
  const runtime = createEmbodimentRuntime({ host: "127.0.0.1", port: 0, backendUrl: `http://127.0.0.1:${backendPort}`, controlTokenFile: tokenFile, internalAuthorization: TEST_CONTROL, speech: TEST_SPEECH, logger: false });
  await runtime.start();
  const runtimePort = (runtime.app.server.address() as { port: number }).port;
  const pairing = new WebSocket(`ws://127.0.0.1:${runtimePort}/embodiment/ws`);
  let invalid: WebSocket | null = null;
  let reconnectingPairing: WebSocket | null = null;
  const reconnectState: { socket: WebSocket | null } = { socket: null };
  try {
    await once(pairing, "open");
    pairing.send(JSON.stringify({ schema_version: 2, type: "pairing.hello", label: "Pairing terminal" }));
    await waitForJson(pairing, (event) => event.type === "pairing.code");
    pairing.send(JSON.stringify({ schema_version: 2, event_id: "pairing_ping", type: "system.ping", sent_at_ms: 1 }));
    const pong = await waitForJson(pairing, (event) => event.type === "system.pong");
    assert.equal(pong.ping_event_id, "pairing_ping");
    pairing.on("message", (data, binary) => {
      if (binary) return;
      const event = JSON.parse(String(data)) as Record<string, unknown>;
      if (event.type === "pairing.credentials") pairing.send(terminalEvent("terminal.credentials_ack", { terminal_id: String(event.terminal_id), terminal_token_version: Number(event.terminal_token_version) }));
    });
    const result = await internal(runtimePort, tokenFile, "/internal/embodiment/pairing/credentials", { pairing_session_id: "pairing_session_123", terminal_id: "terminal_pairing", terminal_token: "p".repeat(32), terminal_token_version: 1 });
    assert.deepEqual(result, { delivered: true, confirmed: true });

    reconnectingPairing = new WebSocket(`ws://127.0.0.1:${runtimePort}/embodiment/ws`);
    await once(reconnectingPairing, "open");
    reconnectingPairing.send(JSON.stringify({ schema_version: 2, type: "pairing.hello", label: "Reconnecting terminal" }));
    await waitForJson(reconnectingPairing, (event) => event.type === "pairing.code");
    const reconnectedReady = new Promise<void>((resolve, reject) => {
      reconnectingPairing?.on("message", (data, binary) => {
        if (binary) return;
        const event = JSON.parse(String(data)) as Record<string, unknown>;
        if (event.type !== "pairing.credentials") return;
        reconnectedToken = String(event.terminal_token);
        const reconnected = new WebSocket(`ws://127.0.0.1:${runtimePort}/embodiment/ws`, { headers: { "x-terminal-id": String(event.terminal_id), "x-terminal-token": reconnectedToken } });
        reconnectState.socket = reconnected;
        reconnected.once("error", reject);
        reconnected.on("message", (raw, isBinary) => {
          if (isBinary) return;
          if ((JSON.parse(String(raw)) as Record<string, unknown>).type === "terminal.ready") resolve();
        });
        reconnected.once("open", () => reconnected?.send(terminalEvent("terminal.hello", { terminal_id: String(event.terminal_id), boot_id: "boot_reconnected", capabilities: { audio_input: "pcm16le_16000_mono", audio_output: "pcm16le_16000_mono", max_audio_payload_bytes: 1024, display: true, buttons: ["a"] } })));
        reconnectingPairing?.close();
      });
    });
    const reconnectDelivery = await internal(runtimePort, tokenFile, "/internal/embodiment/pairing/credentials", { pairing_session_id: "pairing_session_123", terminal_id: "terminal_reconnected", terminal_token: "q".repeat(32), terminal_token_version: 1 });
    assert.deepEqual(reconnectDelivery, { delivered: true, confirmed: true });
    await reconnectedReady;

    invalid = new WebSocket(`ws://127.0.0.1:${runtimePort}/embodiment/ws`, { headers: { "x-terminal-id": "terminal_invalid", "x-terminal-token": "bad-token" } });
    await once(invalid, "open");
    const rejected = await waitForJson(invalid, (event) => event.type === "pairing.invalid");
    assert.equal(rejected.code, "credential_invalid");
  } finally {
    pairing.close();
    reconnectingPairing?.close();
    reconnectState.socket?.close();
    invalid?.close();
    await runtime.stop();
    await backend.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function terminalEvent(type: string, fields: Record<string, unknown>): string { return JSON.stringify({ schema_version: 2, event_id: `event_${Math.random()}`, type, ...fields }); }
async function internal(port: number, tokenFile: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const token = await (await import("node:fs/promises")).readFile(tokenFile, "utf8");
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return await response.json() as Record<string, unknown>;
}
async function internalGet(port: number, tokenFile: string, path: string): Promise<Record<string, unknown>> {
  const token = await (await import("node:fs/promises")).readFile(tokenFile, "utf8");
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: `Bearer ${token.trim()}` } });
  assert.equal(response.status, 200);
  return await response.json() as Record<string, unknown>;
}
function once(socket: WebSocket, event: "open"): Promise<void> { return new Promise((resolve, reject) => { socket.once(event, () => resolve()); socket.once("error", reject); }); }
function waitForMessage(socket: WebSocket, type: string): Promise<void> { return new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.off("message", listener); reject(new Error(`Timed out waiting for ${type}`)); }, 5_000); const listener = (data: WebSocket.RawData, binary: boolean) => { if (binary) return; try { if ((JSON.parse(String(data)) as { type?: unknown }).type === type) { clearTimeout(timer); socket.off("message", listener); resolve(); } } catch { /* existing protocol listener handles it */ } }; socket.on("message", listener); }); }
function waitForJson(socket: WebSocket, predicate: (event: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> { return new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.off("message", listener); reject(new Error("Timed out waiting for JSON event")); }, 5_000); const listener = (data: WebSocket.RawData, binary: boolean) => { if (binary) return; try { const event = JSON.parse(String(data)) as Record<string, unknown>; if (!predicate(event)) return; clearTimeout(timer); socket.off("message", listener); resolve(event); } catch { /* WebSocket errors are asserted elsewhere. */ } }; socket.on("message", listener); }); }

function rawBytes(data: WebSocket.RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function assertShortFinalDownlink(frames: S3auAudioFrame[], ends: Array<{ streamId: number; frameCount: number; totalBytes: number; finalSeq: number | null }>): void {
  const byStream = new Map<number, S3auAudioFrame[]>();
  for (const frame of frames) byStream.set(frame.stream_id, [...(byStream.get(frame.stream_id) ?? []), frame]);
  assert.equal(byStream.size, 2);
  assert.equal(ends.length, 2);
  for (const [streamId, streamFrames] of byStream) {
    assert.equal(streamFrames.length, 34);
    streamFrames.forEach((frame, index) => {
      assert.equal(frame.seq, index);
      assert.equal(frame.flags, index === 33 ? 1 : 0);
      assert.equal(frame.payload.byteLength, index === 33 ? 768 : 1024);
    });
    assert.deepEqual(ends.find((end) => end.streamId === streamId), { streamId, frameCount: 34, totalBytes: 34_560, finalSeq: 33 });
  }
}
