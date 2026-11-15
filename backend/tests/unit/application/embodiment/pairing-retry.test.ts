import assert from "node:assert/strict";
import test from "node:test";

import { EmbodimentApplication, PairingSessions, type CompanyTerminalRecord, type EmbodimentRuntimeGatewayPort, type TerminalRepositoryPort } from "../../../../src/application/embodiment/index.js";

test("a failed pairing delivery releases its code for one later confirmed delivery", async () => {
  const sessions = new PairingSessions();
  const pairing = sessions.open("Desk terminal");
  const terminals = new RecordingTerminals();
  const runtime = new RecordingRuntime([
    { delivered: true, confirmed: false },
    { delivered: true, confirmed: true },
  ]);
  const application = new EmbodimentApplication({
    terminals,
    runtime,
    runtimeAuthorization: { async authorize() { return null; } },
    pairingSessions: sessions,
    createTerminalToken: () => "t".repeat(32),
  });

  assert.deepEqual(await application.claimPairing("company_one", undefined, pairing.code), { delivered: false });
  const confirmed = await application.claimPairing("company_one", undefined, pairing.code);

  assert.equal(confirmed?.delivered, true);
  assert.equal(runtime.deliveries.length, 2);
  assert.equal(terminals.revokedTerminalIds.length, 1);
  assert.equal(sessions.claim(pairing.code), null, "a confirmed pairing consumes its code");
});

class RecordingTerminals implements TerminalRepositoryPort {
  readonly revokedTerminalIds: string[] = [];
  private created = 0;

  async list(): Promise<CompanyTerminalRecord[]> { return []; }
  async create(companyId: string, terminalId: string, label: string): Promise<CompanyTerminalRecord> {
    this.created += 1;
    return { terminal_id: terminalId, company_id: companyId, label, status: "active", current_token_version: 1, created_at_ms: this.created, paired_at_ms: this.created, revoked_at_ms: null, updated_at_ms: this.created };
  }
  async authenticate(): Promise<CompanyTerminalRecord | null> { return null; }
  async prepareRotation(): Promise<{ terminal: CompanyTerminalRecord; terminal_token_version: number }> { throw new Error("not used"); }
  async promotePending(): Promise<void> { throw new Error("not used"); }
  async revoke(_companyId: string, terminalId: string): Promise<CompanyTerminalRecord> {
    this.revokedTerminalIds.push(terminalId);
    return { terminal_id: terminalId, company_id: "company_one", label: "Desk terminal", status: "revoked", current_token_version: 1, created_at_ms: 1, paired_at_ms: 1, revoked_at_ms: 2, updated_at_ms: 2 };
  }
}

class RecordingRuntime implements EmbodimentRuntimeGatewayPort {
  readonly deliveries: unknown[] = [];
  constructor(private readonly results: Array<{ delivered: boolean; confirmed: boolean }>) {}

  async start(): Promise<unknown> { throw new Error("not used"); }
  async exchange(): Promise<unknown> { throw new Error("not used"); }
  async end(): Promise<unknown> { throw new Error("not used"); }
  async deliverPairingCredentials(input: unknown): Promise<{ delivered: boolean; confirmed: boolean }> {
    this.deliveries.push(input);
    const result = this.results.shift();
    if (!result) throw new Error("missing delivery result");
    return result;
  }
  async connectedTerminalIds(): Promise<Set<string> | null> { return new Set(); }
  async disconnectTerminal(): Promise<boolean> { return true; }
}
