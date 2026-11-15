import { lookup } from "node:dns/promises";
import { BlockList, isIP, type Socket } from "node:net";
import { domainToASCII } from "node:url";

import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";

import type { CompanyProxyService } from "../company-proxy/service.js";
import { internalControlTokenMatches } from "../../interface/trpc/core.js";
import { emitLifecycleEvent } from "../../observability/events.js";

const MAX_STREAMS = 128;
const MAX_FRAME_BYTES = 65_540;
const MAX_PENDING_BYTES = 1_048_576;
const CONNECT_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 300_000;

type StreamState = {
  socket: Socket | null;
  pending: Buffer[];
  pendingBytes: number;
  closed: boolean;
  connectTimer: ReturnType<typeof setTimeout>;
};

export function registerDesktopBrowserTunnel(
  app: FastifyInstance,
  options: { companyProxy: CompanyProxyService; controlTokenFile: string },
): { closeAll: () => void } {
  const connections = new Set<WebSocket>();
  app.get("/internal/desktop-browser/tunnel", { websocket: true }, (webSocket, request) => {
    connections.add(webSocket);
    webSocket.once("close", () => connections.delete(webSocket));
    void authorizeAndAttach(webSocket, request.headers.authorization, options).catch(() => {
      emitLifecycleEvent("desktop_browser.tunnel.failed", {
        code: "desktop_browser_tunnel_failed",
        retryable: true,
      });
      webSocket.close(1011, "Tunnel failed");
    });
  });
  return {
    closeAll: () => {
      for (const connection of connections) connection.close(1012, "Proxy configuration changed");
      connections.clear();
    },
  };
}

async function authorizeAndAttach(
  webSocket: WebSocket,
  authorization: string | undefined,
  options: { companyProxy: CompanyProxyService; controlTokenFile: string },
): Promise<void> {
  if (!(await internalControlTokenMatches(authorization, options.controlTokenFile))) {
    emitLifecycleEvent("desktop_browser.tunnel.rejected", {
      code: "desktop_browser_tunnel_unauthorized",
      retryable: false,
    });
    webSocket.close(4001, "Unauthorized");
    return;
  }
  emitLifecycleEvent("desktop_browser.tunnel.connected", {
    code: "desktop_browser_tunnel_connected",
    retryable: false,
  });
  const streams = new Map<number, StreamState>();

  const closeStream = (streamId: number, notify = true) => {
    const state = streams.get(streamId);
    if (!state) return;
    state.closed = true;
    clearTimeout(state.connectTimer);
    state.socket?.destroy();
    streams.delete(streamId);
    if (notify && webSocket.readyState === webSocket.OPEN) {
      webSocket.send(JSON.stringify({ v: 1, type: "close", stream_id: streamId }));
    }
  };

  webSocket.on("message", (raw, isBinary) => {
    if (isBinary) {
      const frame = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      if (frame.length < 5 || frame.length > MAX_FRAME_BYTES) {
        webSocket.close(4002, "Invalid data frame");
        return;
      }
      const streamId = frame.readUInt32BE(0);
      const state = streams.get(streamId);
      if (!state || state.closed) return;
      const payload = frame.subarray(4);
      if (state.socket) {
        state.socket.write(payload);
      } else if (state.pendingBytes + payload.length <= MAX_PENDING_BYTES) {
        state.pending.push(Buffer.from(payload));
        state.pendingBytes += payload.length;
      } else {
        closeStream(streamId);
      }
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      webSocket.close(4002, "Invalid control frame");
      return;
    }
    if (!isControlMessage(message)) {
      webSocket.close(4002, "Invalid control frame");
      return;
    }
    if (message.type === "close" || message.type === "half_close") {
      const state = streams.get(message.stream_id);
      if (message.type === "half_close") state?.socket?.end();
      else closeStream(message.stream_id, false);
      return;
    }
    if (streams.size >= MAX_STREAMS || streams.has(message.stream_id)) {
      sendError(webSocket, message.stream_id, "stream_limit");
      return;
    }
    const state: StreamState = {
      socket: null,
      pending: [],
      pendingBytes: 0,
      closed: false,
      connectTimer: setTimeout(() => {
        sendError(webSocket, message.stream_id, "connect_timeout");
        closeStream(message.stream_id, false);
      }, CONNECT_TIMEOUT_MS),
    };
    streams.set(message.stream_id, state);
    void openStream(message.host, message.port, options.companyProxy).then((socket) => {
      if (state.closed) {
        socket.destroy();
        return;
      }
      clearTimeout(state.connectTimer);
      state.socket = socket;
      socket.setTimeout(IDLE_TIMEOUT_MS);
      socket.on("timeout", () => closeStream(message.stream_id));
      socket.on("data", (chunk: Buffer) => {
        if (webSocket.readyState !== webSocket.OPEN) return;
        if (webSocket.bufferedAmount > MAX_PENDING_BYTES) {
          closeStream(message.stream_id);
          return;
        }
        const frame = Buffer.allocUnsafe(4 + chunk.length);
        frame.writeUInt32BE(message.stream_id, 0);
        chunk.copy(frame, 4);
        webSocket.send(frame, { binary: true });
      });
      socket.on("end", () => {
        if (webSocket.readyState === webSocket.OPEN) {
          webSocket.send(JSON.stringify({ v: 1, type: "half_close", stream_id: message.stream_id }));
        }
      });
      socket.on("close", () => closeStream(message.stream_id));
      socket.on("error", () => {
        sendError(webSocket, message.stream_id, "upstream_error");
        closeStream(message.stream_id, false);
      });
      for (const pending of state.pending) socket.write(pending);
      state.pending = [];
      state.pendingBytes = 0;
      webSocket.send(JSON.stringify({ v: 1, type: "opened", stream_id: message.stream_id }));
    }).catch(() => {
      emitLifecycleEvent("desktop_browser.stream.failed", {
        code: "desktop_browser_connect_failed",
        retryable: true,
      });
      sendError(webSocket, message.stream_id, "connect_failed");
      closeStream(message.stream_id, false);
    });
  });

  webSocket.on("close", () => {
    for (const streamId of [...streams.keys()]) closeStream(streamId, false);
    emitLifecycleEvent("desktop_browser.tunnel.closed", {
      code: "desktop_browser_tunnel_closed",
      retryable: false,
    });
  });
}

async function openStream(host: string, port: number, proxy: CompanyProxyService): Promise<Socket> {
  if (port !== 443) throw new Error("Target is not allowed.");
  return proxy.openBrowserTunnel(await resolvePublicBrowserTarget(host)) as Promise<Socket>;
}

export async function resolvePublicBrowserTarget(
  host: string,
  resolve: typeof lookup = lookup,
): Promise<string> {
  if (isIP(host) !== 0) throw new Error("Target is not allowed.");
  const asciiHost = domainToASCII(host.toLowerCase());
  if (!asciiHost || asciiHost.length > 253 || !/^[a-z0-9.-]+$/u.test(asciiHost)) {
    throw new Error("Target is not allowed.");
  }
  const addresses = await resolve(asciiHost, { all: true, verbatim: true });
  const allowed = addresses.filter(({ address, family }) => !isBlockedAddress(address, family));
  if (allowed.length === 0 || allowed.length !== addresses.length) throw new Error("Target is not public.");
  return allowed[0]!.address;
}

function isBlockedAddress(address: string, family: number): boolean {
  if (family === 6 && /^::ffff:/iu.test(address)) return true;
  return blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

function isControlMessage(value: unknown): value is {
  v: 1;
  type: "open" | "close" | "half_close";
  stream_id: number;
  host: string;
  port: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (input.v !== 1 || !["open", "close", "half_close"].includes(String(input.type))) return false;
  if (!Number.isInteger(input.stream_id) || Number(input.stream_id) < 1) return false;
  if (input.type === "open") return typeof input.host === "string" && Number.isInteger(input.port);
  return true;
}

function sendError(socket: WebSocket, streamId: number, code: string): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ v: 1, type: "error", stream_id: streamId, code }));
  }
}

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10],
  ["ff00::", 8], ["2001:db8::", 32],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv6");
