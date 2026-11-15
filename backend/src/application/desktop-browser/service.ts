import { createHmac, randomBytes } from "node:crypto";
import type WebSocket from "ws";

import type {
  DesktopBrowserSetInput,
  DesktopBrowserStatus,
  DesktopBrowserTunnelStartResult,
} from "@fields/contracts/public/desktop-browser";
import type { CompanyProxyStatus } from "@fields/contracts/public/executor";

type BrowserStateRepository = {
  get(companyId: string): Promise<{ enabled: boolean; updated_at_ms: number | null }>;
  set(companyId: string, input: DesktopBrowserSetInput): Promise<{ enabled: boolean; updated_at_ms: number | null }>;
};

type TokenRecord = {
  companyId: string;
  actorId: string;
  clientNonce: string;
  expiresAtMs: number;
};

const TOKEN_TTL_MS = 60_000;

export class DesktopBrowserService {
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly activeSockets = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly states: BrowserStateRepository,
    private readonly proxyStatus: (companyId: string) => Promise<CompanyProxyStatus>,
    private readonly partitionSecret: string,
    private readonly now: () => number = Date.now,
  ) {}

  async status(companyId: string): Promise<DesktopBrowserStatus> {
    const [state, proxy] = await Promise.all([
      this.states.get(companyId),
      this.proxyStatus(companyId),
    ]);
    return {
      ...state,
      proxy: {
        enabled: proxy.enabled,
        protocol: proxy.protocol,
        revision: proxy.revision,
      },
    };
  }

  async set(companyId: string, input: DesktopBrowserSetInput): Promise<DesktopBrowserStatus> {
    await this.states.set(companyId, input);
    if (!input.enabled) this.closeCompany(companyId, 4003, "Desktop browser disabled");
    return this.status(companyId);
  }

  async start(companyId: string, actorId: string, clientNonce: string): Promise<DesktopBrowserTunnelStartResult> {
    const state = await this.states.get(companyId);
    if (!state.enabled) throw new Error("Desktop browser is disabled.");
    this.purgeExpiredTokens();
    const token = randomBytes(32).toString("base64url");
    const expiresAtMs = this.now() + TOKEN_TTL_MS;
    this.tokens.set(token, { companyId, actorId, clientNonce, expiresAtMs });
    return {
      websocket_path: "/api/v1/desktop-browser/tunnel",
      token,
      storage_partition: createHmac("sha256", this.partitionSecret)
        .update("desktop-browser-partition\0")
        .update(companyId)
        .update("\0")
        .update(actorId)
        .digest("base64url"),
      expires_at_ms: expiresAtMs,
    };
  }

  async consume(token: string, clientNonce: string): Promise<TokenRecord | null> {
    const record = this.tokens.get(token) ?? null;
    this.tokens.delete(token);
    if (!record || record.clientNonce !== clientNonce || record.expiresAtMs < this.now()) return null;
    const state = await this.states.get(record.companyId);
    return state.enabled ? record : null;
  }

  track(companyId: string, socket: WebSocket): () => void {
    const sockets = this.activeSockets.get(companyId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.activeSockets.set(companyId, sockets);
    return () => {
      sockets.delete(socket);
      if (sockets.size === 0) this.activeSockets.delete(companyId);
    };
  }

  closeAll(): void {
    for (const companyId of this.activeSockets.keys()) {
      this.closeCompany(companyId, 1012, "Backend shutting down");
    }
    this.tokens.clear();
  }

  private closeCompany(companyId: string, code: number, reason: string): void {
    const sockets = this.activeSockets.get(companyId);
    if (!sockets) return;
    for (const socket of sockets) socket.close(code, reason);
    this.activeSockets.delete(companyId);
  }

  private purgeExpiredTokens(): void {
    const now = this.now();
    for (const [token, record] of this.tokens) {
      if (record.expiresAtMs < now) this.tokens.delete(token);
    }
  }
}
