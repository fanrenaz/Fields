import { randomBytes, randomUUID } from "node:crypto";

export type PairingSession = { pairing_session_id: string; code: string; label: string; expires_at_ms: number };
export class PairingSessions {
  private readonly sessions = new Map<string, PairingSession & { claiming: boolean }>();
  constructor(private readonly now: () => number = Date.now) {}
  open(label?: string): PairingSession {
    this.clearExpired();
    let code = pairingCode();
    while ([...this.sessions.values()].some((session) => session.code === code)) code = pairingCode();
    const session = { pairing_session_id: randomBytes(24).toString("base64url"), code, label: label?.trim() || "Fields Terminal", expires_at_ms: this.now() + 10 * 60_000, claiming: false };
    this.sessions.set(session.pairing_session_id, session); return session;
  }
  claim(code: string): PairingSession | null {
    this.clearExpired();
    const session = [...this.sessions.values()].find((candidate) => candidate.code === code);
    if (!session || session.claiming) return null;
    session.claiming = true;
    return session;
  }
  complete(session: PairingSession): void { this.sessions.delete(session.pairing_session_id); }
  release(session: PairingSession): void {
    const current = this.sessions.get(session.pairing_session_id);
    if (current && current.code === session.code) current.claiming = false;
  }
  private clearExpired(): void { const now = this.now(); for (const [id, session] of this.sessions) if (session.expires_at_ms <= now) this.sessions.delete(id); }
}
function pairingCode(): string { return randomUUID().replace(/-/gu, "").slice(0, 6).toUpperCase(); }
