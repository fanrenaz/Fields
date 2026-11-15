import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";

import type { DesktopBrowserService } from "../../application/desktop-browser/service.js";
import { emitObservabilityLog } from "../../observability/events.js";

export function registerDesktopBrowserTunnelProxy(
  app: FastifyInstance,
  options: {
    browser: DesktopBrowserService;
    openRuntimeTunnel(companyId: string): Promise<WebSocket>;
  },
): void {
  app.get("/api/v1/desktop-browser/tunnel", { websocket: true }, (client, request) => {
    const credentials = tunnelCredentials(request.headers["sec-websocket-protocol"]);
    void (async () => {
      if (!credentials) {
        emitObservabilityLog("desktop_browser.tunnel.rejected", {
          code: "desktop_browser_tunnel_credentials_missing",
          retryable: false,
        });
        client.close(4001, "Missing tunnel token");
        return;
      }
      const authority = await options.browser.consume(credentials.token, credentials.clientNonce);
      if (!authority) {
        emitObservabilityLog("desktop_browser.tunnel.rejected", {
          code: "desktop_browser_tunnel_credentials_invalid",
          retryable: false,
        });
        client.close(4001, "Invalid tunnel token");
        return;
      }
      let runtime: WebSocket;
      try {
        runtime = await options.openRuntimeTunnel(authority.companyId);
      } catch {
        emitObservabilityLog("desktop_browser.tunnel.failed", {
          code: "desktop_browser_runtime_unavailable",
          retryable: true,
          "fields.company_id": authority.companyId,
        });
        client.close(1013, "Company Runtime unavailable");
        return;
      }
      const untrack = options.browser.track(authority.companyId, client);
      pipe(client, runtime);
      pipe(runtime, client);
      emitObservabilityLog("desktop_browser.tunnel.connected", {
        code: "desktop_browser_tunnel_connected",
        retryable: false,
        "fields.company_id": authority.companyId,
        "fields.actor_id": authority.actorId,
      });
      let closed = false;
      const closeBoth = () => {
        if (closed) return;
        closed = true;
        untrack();
        emitObservabilityLog("desktop_browser.tunnel.closed", {
          code: "desktop_browser_tunnel_closed",
          retryable: false,
          "fields.company_id": authority.companyId,
          "fields.actor_id": authority.actorId,
        });
        if (client.readyState === client.OPEN) client.close();
        if (runtime.readyState === runtime.OPEN) runtime.close();
      };
      client.once("close", closeBoth);
      runtime.once("close", closeBoth);
      client.once("error", closeBoth);
      runtime.once("error", closeBoth);
    })().catch(() => client.close(1011, "Tunnel failed"));
  });
}

function pipe(source: WebSocket, target: WebSocket): void {
  source.on("message", (data, isBinary) => {
    if (target.readyState === target.OPEN) target.send(data, { binary: isBinary });
  });
}

function tunnelCredentials(header: string | string[] | undefined): {
  token: string;
  clientNonce: string;
} | null {
  const value = Array.isArray(header) ? header.join(",") : header ?? "";
  let token: string | null = null;
  let clientNonce: string | null = null;
  for (const protocol of value.split(",").map((item) => item.trim())) {
    if (protocol.startsWith("fields-token.")) {
      const candidate = protocol.slice("fields-token.".length);
      if (/^[A-Za-z0-9_-]{32,256}$/u.test(candidate)) token = candidate;
    } else if (protocol.startsWith("fields-nonce.")) {
      const candidate = protocol.slice("fields-nonce.".length);
      if (/^[A-Za-z0-9_-]{16,128}$/u.test(candidate)) clientNonce = candidate;
    }
  }
  return token && clientNonce ? { token, clientNonce } : null;
}
