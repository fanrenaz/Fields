import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { TerminalNotFoundError } from "../../../../domain/embodiment/index.js";
import type { BackendDatabase } from "../database-service.js";

export type CompanyTerminalView = {
  terminal_id: string;
  company_id: string;
  label: string;
  status: "active" | "revoked";
  current_token_version: number;
  created_at_ms: number;
  paired_at_ms: number;
  revoked_at_ms: number | null;
  updated_at_ms: number;
};

type TerminalRow = {
  device_id: unknown; company_id: unknown; label: unknown; status: unknown;
  current_token_hash: unknown; current_token_version: unknown; pending_token_hash: unknown;
  pending_token_version: unknown; created_at_ms: unknown; paired_at_ms: unknown;
  revoked_at_ms: unknown; updated_at_ms: unknown;
};

export class CompanyTerminalRepository {
  constructor(private readonly db: BackendDatabase, private readonly now: () => number = Date.now) {}

  async list(companyId: string): Promise<CompanyTerminalView[]> {
    const rows = rowsFromResult<TerminalRow>(await this.db.execute(sql`
      select device_id, company_id, label, status, current_token_hash, current_token_version,
        pending_token_hash, pending_token_version, created_at_ms, paired_at_ms, revoked_at_ms, updated_at_ms
      from company_devices where company_id = ${identifier(companyId)} order by created_at_ms asc
    `));
    return rows.map(viewFromRow);
  }

  async create(companyId: string, terminalId: string, label: string, token: string): Promise<CompanyTerminalView> {
    const now = this.now();
    const rows = rowsFromResult<TerminalRow>(await this.db.execute(sql`
      insert into company_devices (
        device_id, company_id, label, status, current_token_hash, current_token_version,
        created_at_ms, paired_at_ms, updated_at_ms
      ) values (
        ${identifier(terminalId)}, ${identifier(companyId)}, ${labelValue(label)}, 'active', ${tokenHash(token)}, 1,
        ${now}, ${now}, ${now}
      ) returning device_id, company_id, label, status, current_token_hash, current_token_version,
        pending_token_hash, pending_token_version, created_at_ms, paired_at_ms, revoked_at_ms, updated_at_ms
    `));
    if (rows.length !== 1 || !rows[0]) throw new Error("Company Terminal creation failed.");
    return viewFromRow(rows[0]);
  }

  async authenticate(terminalId: string, token: string): Promise<CompanyTerminalView | null> {
    const rows = rowsFromResult<TerminalRow>(await this.db.execute(sql`
      select device_id, company_id, label, status, current_token_hash, current_token_version,
        pending_token_hash, pending_token_version, created_at_ms, paired_at_ms, revoked_at_ms, updated_at_ms
      from company_devices where device_id = ${identifier(terminalId)} and status = 'active' limit 2
    `));
    if (rows.length !== 1 || !rows[0] || !constantTimeEqual(stringValue(rows[0].current_token_hash), tokenHash(token))) return null;
    return viewFromRow(rows[0]);
  }

  async prepareRotation(companyId: string, terminalId: string, token: string): Promise<{ terminal: CompanyTerminalView; terminal_token_version: number }> {
    const now = this.now();
    const rows = rowsFromResult<TerminalRow>(await this.db.execute(sql`
      update company_devices
      set pending_token_hash = ${tokenHash(token)}, pending_token_version = current_token_version + 1, updated_at_ms = ${now}
      where company_id = ${identifier(companyId)} and device_id = ${identifier(terminalId)} and status = 'active'
      returning device_id, company_id, label, status, current_token_hash, current_token_version,
        pending_token_hash, pending_token_version, created_at_ms, paired_at_ms, revoked_at_ms, updated_at_ms
    `));
    if (rows.length !== 1 || !rows[0]) throw new TerminalNotFoundError();
    const terminal = viewFromRow(rows[0]);
    const version = numberValue(rows[0].pending_token_version);
    return { terminal, terminal_token_version: version };
  }

  async promotePending(companyId: string, terminalId: string, version: number): Promise<void> {
    const now = this.now();
    const rows = rowsFromResult<TerminalRow>(await this.db.execute(sql`
      update company_devices
      set current_token_hash = pending_token_hash, current_token_version = pending_token_version,
        pending_token_hash = null, pending_token_version = null, updated_at_ms = ${now}
      where company_id = ${identifier(companyId)} and device_id = ${identifier(terminalId)} and status = 'active'
        and pending_token_version = ${positiveInteger(version)} and pending_token_hash is not null
      returning device_id
    `));
    if (rows.length !== 1) throw new TerminalNotFoundError();
  }

  async revoke(companyId: string, terminalId: string): Promise<CompanyTerminalView> {
    const now = this.now();
    const rows = rowsFromResult<TerminalRow>(await this.db.execute(sql`
      update company_devices set status = 'revoked', revoked_at_ms = ${now}, pending_token_hash = null,
        pending_token_version = null, updated_at_ms = ${now}
      where company_id = ${identifier(companyId)} and device_id = ${identifier(terminalId)} and status = 'active'
      returning device_id, company_id, label, status, current_token_hash, current_token_version,
        pending_token_hash, pending_token_version, created_at_ms, paired_at_ms, revoked_at_ms, updated_at_ms
    `));
    if (rows.length !== 1 || !rows[0]) throw new TerminalNotFoundError();
    return viewFromRow(rows[0]);
  }
}

export function newTerminalToken(): string { return randomBytes(32).toString("base64url"); }
export function tokenHash(token: string): string {
  if (typeof token !== "string" || token.length < 32 || token.length > 512 || /[\r\n]/u.test(token)) throw new Error("Invalid terminal credential.");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function rowsFromResult<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && "rows" in value && Array.isArray((value as { rows?: unknown }).rows)) return (value as { rows: T[] }).rows;
  return [];
}
function identifier(value: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new Error("Invalid identifier."); return value; }
function labelValue(value: string): string { if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) throw new Error("Invalid terminal label."); return value.trim(); }
function positiveInteger(value: number): number { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid token version."); return value; }
function stringValue(value: unknown): string { if (typeof value !== "string" || value.length === 0) throw new Error("Invalid persisted terminal."); return value; }
function numberValue(value: unknown): number { const parsed = typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : Number(value); if (!Number.isSafeInteger(parsed)) throw new Error("Invalid persisted terminal."); return parsed; }
function nullableNumber(value: unknown): number | null { return value == null ? null : numberValue(value); }
function viewFromRow(row: TerminalRow): CompanyTerminalView { const status = stringValue(row.status); if (status !== "active" && status !== "revoked") throw new Error("Invalid persisted terminal."); return { terminal_id: stringValue(row.device_id), company_id: stringValue(row.company_id), label: stringValue(row.label), status, current_token_version: numberValue(row.current_token_version), created_at_ms: numberValue(row.created_at_ms), paired_at_ms: numberValue(row.paired_at_ms), revoked_at_ms: nullableNumber(row.revoked_at_ms), updated_at_ms: numberValue(row.updated_at_ms) }; }
function constantTimeEqual(left: string, right: string): boolean { if (left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0; }
