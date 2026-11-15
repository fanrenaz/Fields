import { randomUUID } from "node:crypto";

import {
  companyTerminalBindingSchema,
  companyTerminalSummarySchema,
  companyTerminalsListResultSchema,
  pairingClaimResultSchema,
} from "@fields/contracts/public/embodiment";

import { isActiveCompanyTerminal, type EmbodimentCallOwner } from "../../domain/embodiment/index.js";
import { PairingSessions } from "./pairing-sessions.js";
import type {
  EmbodimentRuntimeGatewayPort,
  RuntimeCallAuthorizationPort,
  RuntimeEmbodimentHeaders,
  TerminalRepositoryPort,
} from "./ports.js";

export type EmbodimentApplicationDependencies = {
  terminals: TerminalRepositoryPort;
  runtime: EmbodimentRuntimeGatewayPort;
  runtimeAuthorization: RuntimeCallAuthorizationPort;
  pairingSessions?: PairingSessions;
  createTerminalToken(): string;
};

/**
 * Embodiment use cases. This layer owns the product workflow but not the
 * transport, database, runtime process, or Actor/Room/Execution persistence.
 */
export class EmbodimentApplication {
  private readonly sessions: PairingSessions;

  constructor(private readonly dependencies: EmbodimentApplicationDependencies) {
    this.sessions = dependencies.pairingSessions ?? new PairingSessions();
  }

  async listTerminals(companyId: string) {
    const activeTerminals = (await this.dependencies.terminals.list(companyId)).filter((terminal) => terminal.status === "active");
    const connectedTerminalIds = await this.dependencies.runtime.connectedTerminalIds();
    return companyTerminalsListResultSchema.parse({
      items: activeTerminals.map((terminal) => companyTerminalSummarySchema.parse({
        ...publicTerminal(terminal),
        connection_status: connectedTerminalIds === null
          ? "unknown"
          : connectedTerminalIds.has(terminal.terminal_id) ? "online" : "offline",
      })),
    });
  }

  async listTerminalsForRuntime(headers: RuntimeEmbodimentHeaders) {
    const actor = await this.dependencies.runtimeAuthorization.authorize(headers);
    if (!actor) return null;
    return this.listTerminals(actor.company_id);
  }

  openPairing(label?: string) {
    return this.sessions.open(label);
  }

  async claimPairing(companyId: string, label: string | undefined, code: string) {
    const session = this.sessions.claim(code);
    if (!session) return null;
    let completed = false;
    try {
      const token = this.dependencies.createTerminalToken();
      const terminal = await this.dependencies.terminals.create(companyId, `terminal_${randomUUID()}`, label ?? session.label, token);
      const delivery = await this.dependencies.runtime.deliverPairingCredentials({
        pairing_session_id: session.pairing_session_id,
        terminal_id: terminal.terminal_id,
        terminal_token: token,
        terminal_token_version: terminal.current_token_version,
      });
      if (!delivery.delivered || !delivery.confirmed) {
        await this.dependencies.terminals.revoke(companyId, terminal.terminal_id);
        return { delivered: false as const };
      }
      this.sessions.complete(session);
      completed = true;
      return { delivered: true as const, result: pairingClaimResultSchema.parse({ terminal: publicTerminal(terminal) }) };
    } finally {
      if (!completed) this.sessions.release(session);
    }
  }

  async rotateTerminal(companyId: string, terminalId: string) {
    const token = this.dependencies.createTerminalToken();
    const prepared = await this.dependencies.terminals.prepareRotation(companyId, terminalId, token);
    const delivery = await this.dependencies.runtime.deliverPairingCredentials({
      pairing_session_id: `terminal:${prepared.terminal.terminal_id}`,
      terminal_id: prepared.terminal.terminal_id,
      terminal_token: token,
      terminal_token_version: prepared.terminal_token_version,
    });
    if (!delivery.delivered || !delivery.confirmed) return { delivered: false as const };
    await this.dependencies.terminals.promotePending(companyId, prepared.terminal.terminal_id, prepared.terminal_token_version);
    return { delivered: true as const, result: pairingClaimResultSchema.parse({ terminal: publicTerminal(prepared.terminal) }) };
  }

  async revokeTerminal(companyId: string, terminalId: string) {
    const disconnected = await this.dependencies.runtime.disconnectTerminal(terminalId);
    if (!disconnected) return { disconnected: false as const };
    await this.dependencies.terminals.revoke(companyId, terminalId);
    return { disconnected: true as const, terminal_id: terminalId };
  }

  async authenticateTerminal(terminalId: string, token: string): Promise<boolean> {
    return (await this.dependencies.terminals.authenticate(terminalId, token)) !== null;
  }

  async invokeCall(headers: RuntimeEmbodimentHeaders, input: unknown, invoke: (actor: EmbodimentCallOwner) => Promise<unknown>): Promise<unknown | null> {
    const actor = await this.dependencies.runtimeAuthorization.authorize(headers);
    if (!actor) return null;
    const terminalId = input && typeof input === "object" && "terminal_id" in input && typeof input.terminal_id === "string"
      ? input.terminal_id
      : null;
    if (terminalId) {
      const terminals = await this.dependencies.terminals.list(actor.company_id);
      if (!terminals.some((terminal) => isActiveCompanyTerminal(terminal, actor.company_id) && terminal.terminal_id === terminalId)) return null;
    }
    return invoke(actor);
  }

  start(actor: EmbodimentCallOwner, input: unknown): Promise<unknown> { return this.dependencies.runtime.start({ actor, call: input }); }
  exchange(actor: EmbodimentCallOwner, input: unknown): Promise<unknown> { return this.dependencies.runtime.exchange({ actor, call: input }); }
  end(actor: EmbodimentCallOwner, input: unknown): Promise<unknown> { return this.dependencies.runtime.end({ actor, call: input }); }
}

function publicTerminal(terminal: { terminal_id: string; label: string; status: string; paired_at_ms: number }) {
  return companyTerminalBindingSchema.parse({
    terminal_id: terminal.terminal_id,
    label: terminal.label,
    status: terminal.status,
    paired_at_ms: terminal.paired_at_ms,
  });
}
