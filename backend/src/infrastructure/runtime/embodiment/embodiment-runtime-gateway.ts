import { readFile } from "node:fs/promises";

import {
  embodimentRuntimeConnectedTerminalsResultSchema,
  embodimentRuntimeTerminalDisconnectResultSchema,
} from "@fields/contracts/internal/embodiment-runtime";

export type TerminalCredentialDelivery = {
  delivered: boolean;
  confirmed: boolean;
};

export class EmbodimentRuntimeGateway {
  constructor(private readonly baseUrl: string, private readonly tokenFile: string) {}

  async start(body: unknown): Promise<unknown> { return this.post("/internal/embodiment/call/start", body); }
  async exchange(body: unknown): Promise<unknown> { return this.post("/internal/embodiment/call/exchange", body); }
  async end(body: unknown): Promise<unknown> { return this.post("/internal/embodiment/call/end", body); }
  async deliverPairingCredentials(body: unknown): Promise<TerminalCredentialDelivery> {
    const result = await this.post("/internal/embodiment/pairing/credentials", body);
    return {
      delivered: result?.delivered === true,
      confirmed: result?.confirmed === true,
    };
  }
  async connectedTerminalIds(): Promise<Set<string> | null> {
    const result = await this.get("/internal/embodiment/terminals/status");
    const parsed = embodimentRuntimeConnectedTerminalsResultSchema.safeParse(result);
    return parsed.success ? new Set(parsed.data.items.map((item) => item.terminal_id)) : null;
  }
  async disconnectTerminal(terminalId: string): Promise<boolean> {
    const result = await this.post("/internal/embodiment/terminal/disconnect", { terminal_id: terminalId });
    return embodimentRuntimeTerminalDisconnectResultSchema.safeParse(result).success;
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
    return this.request("POST", path, body);
  }

  private async get(path: string): Promise<Record<string, unknown> | null> {
    return this.request("GET", path);
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown> | null> {
    let token: string;
    try { token = (await readFile(this.tokenFile, "utf8")).trim(); } catch { return null; }
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/u, "")}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) return null;
      const payload = await response.json() as unknown;
      return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    } catch { return null; }
  }
}
