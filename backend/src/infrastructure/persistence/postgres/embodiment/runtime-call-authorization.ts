import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

import { sql } from "drizzle-orm";

import type {
  RuntimeCallAuthorizationPort,
  RuntimeEmbodimentHeaders as ApplicationRuntimeEmbodimentHeaders,
} from "../../../../application/embodiment/ports.js";
import type { BackendDatabase } from "../database-service.js";

export type RuntimeEmbodimentIdentity = { actor_id: string; company_id: string };
export type RuntimeEmbodimentHeaders = ApplicationRuntimeEmbodimentHeaders;
export type FixedRuntimeAuthorizationOptions = {
  companyId: string;
  controlTokenFile: string;
};

/** Authorizes the one fixed Company Runtime and an active member scope. */
export async function authorizeRuntimeEmbodimentCall(
  db: BackendDatabase,
  headers: RuntimeEmbodimentHeaders,
  options: FixedRuntimeAuthorizationOptions,
): Promise<RuntimeEmbodimentIdentity | null> {
  const memberId = identifier(headers.memberId);
  const companyId = identifier(headers.runtimeId);
  const token = bearer(headers.authorization);
  if (
    headers.kind !== "company"
    || !memberId
    || !companyId
    || companyId !== options.companyId
    || !token
  ) {
    return null;
  }
  let controlToken: string;
  try {
    controlToken = (await readFile(options.controlTokenFile, "utf8")).trim();
  } catch {
    return null;
  }
  if (!matchesToken(token, controlToken)) return null;

  const rows = rowList<{ company_id: string }>(await db.execute(sql`
    select company_id from actors
    where id = ${memberId}
      and company_id = ${companyId}
      and status = 'active'
    limit 2
  `));
  return rows.length === 1 ? { actor_id: memberId, company_id: companyId } : null;
}

export class PostgresRuntimeEmbodimentAuthorization implements RuntimeCallAuthorizationPort {
  constructor(
    private readonly db: BackendDatabase,
    private readonly options: FixedRuntimeAuthorizationOptions,
  ) {}

  authorize(headers: RuntimeEmbodimentHeaders): Promise<RuntimeEmbodimentIdentity | null> {
    return authorizeRuntimeEmbodimentCall(this.db, headers, this.options);
  }
}

function matchesToken(token: string, expectedToken: string): boolean {
  if (!token || !expectedToken) return false;
  const actual = Buffer.from(token, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function rowList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && "rows" in value) {
    const rows = (value as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }
  return [];
}

function identifier(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

function bearer(value: string | undefined): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length);
  return token && token.length <= 4096 && !/[\r\n]/u.test(token) ? token : null;
}
