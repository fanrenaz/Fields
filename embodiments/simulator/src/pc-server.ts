#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import {
  PC_BINARY_DOWNLINK_PCM,
  PC_BINARY_FRAME,
  PC_FRAME_FORMAT_RGB565LE,
  PC_FRAME_FORMAT_RGBA8888,
  PC_FRAME_HEADER_BYTES,
  PC_FRAME_MAGIC,
  PC_FRAME_VERSION,
  pcClientCommand,
  type PcServerMessage,
  type PcSnapshot,
} from "./pc-protocol.js";

const RECORDING_MAX_MS = 60_000;
const RECORDING_MAX_BYTES = 60 * 16_000 * 2;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8790;
const RUNNER_SHUTDOWN_TIMEOUT_MS = 1_000;
const IPC_MAX_LINE_BYTES = 65_536;
const FRAME_MAX_WIDTH = 320;
const FRAME_MAX_HEIGHT = 320;
const FRAME_MAX_PAYLOAD_BYTES = FRAME_MAX_WIDTH * FRAME_MAX_HEIGHT * 4;

type RunnerMessage =
  | PcSnapshot
  | { type: "pairing.status"; pairing: PcSnapshot["pairing"] }
  | { type: "terminal.event"; event: Record<string, unknown> }
  | { type: "downlink.start"; stream_id: number; byte_length: number; sample_rate_hz: 16_000 }
  | { type: "downlink.pcm"; stream_id: number; pcm16le_b64: string }
  | { type: "downlink.end"; stream_id: number }
  | { type: "recording.limit"; max_duration_ms: 60_000 }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export type PcSimulatorServerOptions = {
  host?: string;
  port?: number;
  basePath?: string;
  nonce?: string;
  webDir?: string;
  terminalUrl?: string;
  runnerPath?: string;
  runnerArgs?: string[];
  pairingLabel?: string;
};

export type PcSimulatorServer = {
  nonce: string;
  start(): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
};

export function createPcSimulatorServer(options: PcSimulatorServerOptions = {}): PcSimulatorServer {
  const host = options.host ?? process.env.STICKS3_PC_HOST ?? DEFAULT_HOST;
  const configuredPort = options.port ?? parsePort(process.env.STICKS3_PC_PORT) ?? DEFAULT_PORT;
  const basePath = parseBasePath(options.basePath ?? process.env.STICKS3_PC_BASE_PATH);
  const nonce = options.nonce ?? randomBytes(24).toString("base64url");
  const webDir = options.webDir ?? resolve(dirname(fileURLToPath(import.meta.url)), "../web");
  const runnerPath = options.runnerPath ?? process.env.STICKS3_PC_RUNNER_PATH ?? "sticks3-pc-runner";
  const runnerArgs = options.runnerArgs ?? [];
  const terminalUrl = options.terminalUrl ?? process.env.STICKS3_TERMINAL_WS_URL;
  const pairingLabel = options.pairingLabel ?? process.env.STICKS3_PC_PAIRING_LABEL ?? "PC soft terminal";

  let activeSocket: WebSocket | null = null;
  let runner: ChildProcessWithoutNullStreams | null = null;
  let controllerState: PcSnapshot["controller_state"] = "ready";
  let terminalState: PcSnapshot["terminal_state"] = "offline";
  let browserTerminalId = process.env.STICKS3_TERMINAL_ID ?? "pc-simulator-unpaired";
  let pairing: PcSnapshot["pairing"] = { state: "unpaired", code: null, expires_at_ms: null };
  let callDisplay: PcSnapshot["call"] = null;
  let recordingBytes = 0;
  let recordingTimer: ReturnType<typeof setTimeout> | null = null;
  let runnerFrameBytes = Buffer.alloc(0);
  let started = false;

  const http = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${configuredPort}`}`);
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" }).end();
        return;
      }
      if (url.pathname === "/health") {
        sendJson(response, 200, { status: "ok", controller_active: activeSocket?.readyState === WebSocket.OPEN, terminal_state: terminalState });
        return;
      }
      if (url.pathname === "/favicon.ico") {
        response.writeHead(204, { "Cache-Control": "public, max-age=86400" }).end();
        return;
      }
      const assets: Record<string, { name: string; type: string }> = {
        "/": { name: "index.html", type: "text/html; charset=utf-8" },
        "/app.js": { name: "app.js", type: "text/javascript; charset=utf-8" },
        "/styles.css": { name: "styles.css", type: "text/css; charset=utf-8" },
        "/audio-worklet.js": { name: "audio-worklet.js", type: "text/javascript; charset=utf-8" },
        "/audio-utils.js": { name: "audio-utils.js", type: "text/javascript; charset=utf-8" },
      };
      const asset = assets[url.pathname];
      if (!asset || extname(asset.name) === "") {
        response.writeHead(404).end("Not found");
        return;
      }
      let body = await readFile(resolve(webDir, asset.name));
      if (asset.name === "index.html") body = Buffer.from(body.toString("utf8")
        .replaceAll("__PC_SESSION_NONCE__", nonce).replaceAll("__PC_BASE_PATH__", basePath));
      response.writeHead(200, {
        "Content-Type": asset.type,
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws: wss:; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      response.end(body);
    } catch {
      sendJson(response, 500, { error: "PC terminal asset failed" });
    }
  });

  const sockets = new WebSocketServer({ noServer: true });
  http.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${configuredPort}`}`);
    if (url.pathname !== "/pc/ws" || url.searchParams.get("nonce") !== nonce || !sameOrigin(request.headers.origin, request.headers.host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit("connection", ws));
  });

  sockets.on("connection", (socket) => {
    if (activeSocket?.readyState === WebSocket.OPEN) {
      send(socket, { type: "error", code: "controller_busy", message: "Another PC controller is active.", recoverable: true });
      socket.close(1008, "controller_busy");
      return;
    }
    activeSocket = socket;
    sendSnapshot();
    socket.on("message", (data, isBinary) => {
      try {
        if (isBinary) {
          void acceptPcm(toBytes(data)).catch((error: unknown) => reportError("invalid_pcm", error));
          return;
        }
        const raw = typeof data === "string" ? data : Buffer.from(toBytes(data)).toString("utf8");
        const command = pcClientCommand.parse(JSON.parse(raw));
        void handleCommand(command).catch((error: unknown) => reportError("command_failed", error));
      } catch (error) {
        reportError("invalid_message", error);
      }
    });
    socket.once("close", releaseController);
    socket.on("error", releaseController);
  });

  function currentSnapshot(): PcSnapshot {
    return { type: "snapshot", controller_state: controllerState, terminal_state: terminalState,
      terminal_id: browserTerminalId, pairing, call: callDisplay };
  }

  function sendSnapshot(): void { send(activeSocket, currentSnapshot()); }

  async function handleCommand(command: ReturnType<typeof pcClientCommand.parse>): Promise<void> {
    if (command.type === "keepalive") { sendSnapshot(); return; }
    if (command.type === "activate") {
      if (!runner) startRunner();
      await sendRunner({ type: "activate" });
      return;
    }
    if (!runner) throw new Error("activate the PC terminal first");
    if (command.type === "button.a" || command.type === "answer" || command.type === "record.start") {
      await sendRunner({ type: "button.a" });
      if (command.type === "record.start") startRecordingLimit();
    } else if (command.type === "button.b" || command.type === "decline" || command.type === "hangup" || command.type === "record.stop") {
      await sendRunner({ type: "button.b" });
      if (command.type === "record.stop") clearRecordingTimer();
    } else if (command.type === "playback.complete") {
      await sendRunner({ type: "playback.complete", stream_id: command.stream_id, status: command.status });
    }
  }

  async function acceptPcm(bytes: Uint8Array): Promise<void> {
    if (!runner || terminalState !== "recording") throw new Error("PCM received while not recording");
    if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) throw new Error("PCM16LE chunks must have even byte length");
    const acceptedLength = Math.min(bytes.byteLength, RECORDING_MAX_BYTES - recordingBytes) & ~1;
    if (acceptedLength > 0) {
      recordingBytes += acceptedLength;
      await sendRunner({ type: "uplink.pcm", pcm16le_b64: Buffer.from(bytes.slice(0, acceptedLength)).toString("base64") });
    }
    if (recordingBytes >= RECORDING_MAX_BYTES) stopAtRecordingLimit();
  }

  function startRecordingLimit(): void {
    clearRecordingTimer();
    recordingBytes = 0;
    recordingTimer = setTimeout(stopAtRecordingLimit, RECORDING_MAX_MS);
  }

  function stopAtRecordingLimit(): void {
    clearRecordingTimer();
    if (runner && terminalState === "recording") void sendRunner({ type: "button.a" }).catch(() => undefined);
    send(activeSocket, { type: "recording.limit", max_duration_ms: RECORDING_MAX_MS });
  }

  function clearRecordingTimer(): void {
    if (recordingTimer) clearTimeout(recordingTimer);
    recordingTimer = null;
    recordingBytes = 0;
  }

  function startRunner(): void {
    controllerState = "connecting";
    const environment = {
      ...process.env,
      ...(terminalUrl ? { STICKS3_TERMINAL_WS_URL: terminalUrl } : {}),
      STICKS3_PC_PAIRING_LABEL: pairingLabel,
    };
    let child: ChildProcessWithoutNullStreams;
    try {
      // fd 3 is a dedicated binary framebuffer stream.  Stdout remains a
      // bounded line-oriented control protocol so a frame can never be parsed
      // as JSON or leak into browser-visible diagnostics.
      child = spawn(runnerPath, runnerArgs, { env: environment, stdio: ["pipe", "pipe", "pipe", "pipe"] }) as unknown as ChildProcessWithoutNullStreams;
    } catch (error) {
      controllerState = "error";
      sendSnapshot();
      reportError("runner_unavailable", error);
      return;
    }
    runner = child;
    runnerFrameBytes = Buffer.alloc(0);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => handleRunnerLine(line));
    const framePipe = child.stdio[3];
    if (framePipe instanceof Readable) {
      framePipe.on("data", (chunk: Buffer) => handleRunnerFrameBytes(Buffer.from(chunk)));
      framePipe.on("error", () => reportError("runner_frame_protocol_error", new Error("frame pipe failed")));
    } else {
      controllerState = "error";
      sendSnapshot();
      reportError("runner_unavailable", new Error("runner frame pipe is unavailable"));
      child.kill("SIGTERM");
      return;
    }
    child.stderr.on("data", () => undefined); // never forward runner diagnostics into browser state.
    child.once("error", (error) => {
      if (runner !== child) return;
      runner = null; controllerState = "error"; sendSnapshot(); reportError("runner_unavailable", error);
    });
    child.once("exit", () => {
      if (runner !== child) return;
      runner = null;
      if (activeSocket?.readyState === WebSocket.OPEN) {
        controllerState = "error"; terminalState = "offline"; clearRecordingTimer(); sendSnapshot();
        send(activeSocket, { type: "error", code: "runner_exited", message: "PC terminal stopped.", recoverable: true });
      }
    });
    sendSnapshot();
  }

  function handleRunnerLine(line: string): void {
    if (line.length === 0 || line.length > IPC_MAX_LINE_BYTES) { reportError("runner_protocol_error", new Error("invalid runner output")); return; }
    let message: RunnerMessage;
    try { message = JSON.parse(line) as RunnerMessage; } catch { reportError("runner_protocol_error", new Error("invalid runner output")); return; }
    if (!message || typeof message !== "object" || !("type" in message)) { reportError("runner_protocol_error", new Error("invalid runner output")); return; }
    if (message.type === "snapshot") {
      const wasRecording = terminalState === "recording";
      controllerState = message.controller_state; terminalState = message.terminal_state;
      browserTerminalId = message.terminal_id; pairing = message.pairing; callDisplay = message.call;
      if (terminalState !== "recording") clearRecordingTimer();
      else if (!wasRecording) startRecordingLimit();
      sendSnapshot();
    } else if (message.type === "downlink.pcm") {
      sendBinary(activeSocket, PC_BINARY_DOWNLINK_PCM, Buffer.from(message.pcm16le_b64, "base64"));
    } else {
      send(activeSocket, message as PcServerMessage);
    }
  }

  function handleRunnerFrameBytes(chunk: Buffer): void {
    if (chunk.byteLength === 0) return;
    if (runnerFrameBytes.byteLength + chunk.byteLength > PC_FRAME_HEADER_BYTES + FRAME_MAX_PAYLOAD_BYTES) {
      runnerFrameBytes = Buffer.alloc(0);
      reportError("runner_frame_protocol_error", new Error("runner frame buffer exceeds limit"));
      return;
    }
    runnerFrameBytes = Buffer.concat([runnerFrameBytes, chunk]);
    while (runnerFrameBytes.byteLength >= PC_FRAME_HEADER_BYTES) {
      if (runnerFrameBytes.subarray(0, 4).toString("ascii") !== PC_FRAME_MAGIC ||
          runnerFrameBytes[4] !== PC_FRAME_VERSION ||
          runnerFrameBytes.readUInt16LE(6) !== PC_FRAME_HEADER_BYTES) {
        runnerFrameBytes = Buffer.alloc(0);
        reportError("runner_frame_protocol_error", new Error("invalid runner frame header"));
        return;
      }
      const pixelFormat = runnerFrameBytes[5];
      const width = runnerFrameBytes.readUInt16LE(12);
      const height = runnerFrameBytes.readUInt16LE(14);
      const payloadBytes = runnerFrameBytes.readUInt32LE(16);
      const bytesPerPixel = pixelFormat === PC_FRAME_FORMAT_RGB565LE ? 2
        : pixelFormat === PC_FRAME_FORMAT_RGBA8888 ? 4 : 0;
      const expectedPayloadBytes = width * height * bytesPerPixel;
      if (bytesPerPixel === 0 || width === 0 || height === 0 ||
          width > FRAME_MAX_WIDTH || height > FRAME_MAX_HEIGHT ||
          payloadBytes !== expectedPayloadBytes || payloadBytes > FRAME_MAX_PAYLOAD_BYTES) {
        runnerFrameBytes = Buffer.alloc(0);
        reportError("runner_frame_protocol_error", new Error("invalid runner frame dimensions"));
        return;
      }
      const frameBytes = PC_FRAME_HEADER_BYTES + payloadBytes;
      if (runnerFrameBytes.byteLength < frameBytes) return;
      sendBinary(activeSocket, PC_BINARY_FRAME, runnerFrameBytes.subarray(0, frameBytes));
      runnerFrameBytes = runnerFrameBytes.subarray(frameBytes);
    }
  }

  async function sendRunner(message: Record<string, unknown>): Promise<void> {
    const input = runner?.stdin;
    if (!input || runner?.exitCode !== null) throw new Error("PC terminal runner is unavailable");
    const line = `${JSON.stringify(message)}\n`;
    if (line.length > IPC_MAX_LINE_BYTES) throw new Error("runner command is too large");
    if (input.write(line)) return;
    await new Promise<void>((resolve, reject) => {
      input.once("drain", resolve);
      input.once("error", reject);
    });
  }

  function releaseController(): void {
    activeSocket = null;
    clearRecordingTimer();
    const child = runner;
    runner = null;
    callDisplay = null;
    runnerFrameBytes = Buffer.alloc(0);
    terminalState = "offline";
    controllerState = "ready";
    if (!child) return;
    try { child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`); } catch { /* process is already gone */ }
    const timeout = setTimeout(() => { if (child.exitCode === null) child.kill("SIGTERM"); }, RUNNER_SHUTDOWN_TIMEOUT_MS);
    child.once("exit", () => clearTimeout(timeout));
  }

  function reportError(code: string, _error: unknown): void {
    send(activeSocket, { type: "error", code, message: "PC terminal request failed.", recoverable: true });
  }

  return {
    nonce,
    async start() {
      if (started) throw new Error("PC simulator server is already started");
      const address = await new Promise<{ host: string; port: number }>((resolveAddress, reject) => {
        http.once("error", reject);
        http.listen(configuredPort, host, () => {
          http.off("error", reject);
          const bound = http.address();
          if (!bound || typeof bound === "string") return reject(new Error("PC simulator did not bind a TCP port"));
          resolveAddress({ host, port: bound.port });
        });
      });
      started = true;
      return address;
    },
    async stop() {
      releaseController();
      for (const socket of sockets.clients) socket.close(1001, "server_stopping");
      sockets.close();
      if (started) await closeHttp(http);
      started = false;
    },
  };
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

function parseBasePath(value: string | undefined): string {
  const basePath = value ?? "/";
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(basePath)) throw new Error("STICKS3_PC_BASE_PATH must start and end with '/'");
  return basePath;
}

function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

function send(socket: WebSocket | null, message: PcServerMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendBinary(socket: WebSocket | null, kind: number, payload: Uint8Array): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const envelope = Buffer.allocUnsafe(payload.byteLength + 1);
  envelope[0] = kind;
  Buffer.from(payload).copy(envelope, 1);
  socket.send(envelope);
}

function sendJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(value));
}

function closeHttp(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("unsupported WebSocket binary payload");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPcSimulatorServer();
  void server.start().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
  const shutdown = () => { void server.stop().finally(() => process.exit(0)); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
