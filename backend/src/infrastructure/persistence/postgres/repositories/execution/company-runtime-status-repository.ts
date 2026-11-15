import { sql } from "drizzle-orm";

import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";

export const COMPANY_RUNTIME_STATUS_ACCESS_DENIED_CODE = "COMPANY_RUNTIME_STATUS_ACCESS_DENIED";
export const COMPANY_RUNTIME_STATUS_INVALID_CODE = "COMPANY_RUNTIME_STATUS_INVALID";
export const COMPANY_RUNTIME_STATUS_UNAVAILABLE_CODE = "COMPANY_RUNTIME_STATUS_UNAVAILABLE";

export type CompanyRuntimeStatus = {
  companyId: string;
  status: "pending" | "provisioning" | "initializing" | "ready" | "degraded" | "failed";
  lastHeartbeatAtMs: number | null;
  memberAppServers: {
    running: number;
    idle: number;
    switching: number;
    failed: number;
  };
  activeExecutionCount: number;
  error: { code: string; retryable: boolean } | null;
};

type DatabaseNumber = number | string | bigint;

type RuntimeStatusRow = {
  company_id: string;
  company_status: string;
  runtime_state: string | null;
  last_heartbeat_at_ms: DatabaseNumber | null;
  status_json: unknown;
  active_execution_count: DatabaseNumber | null;
  last_error_code: string | null;
  last_error_retryable: boolean | null;
};

export class PostgresCompanyRuntimeStatusRepository {
  constructor(private readonly db: BackendDatabase) {}

  async read(input: {
    companyId: string;
    requestedByMemberId: string;
  }): Promise<CompanyRuntimeStatus> {
    try {
      const rows = rowsFromResult<RuntimeStatusRow>(await this.db.execute(sql`
        select company.id as company_id, company.status as company_status,
          runtime.state as runtime_state, runtime.observed_at_ms as last_heartbeat_at_ms,
          runtime.status_json, runtime.active_execution_count,
          runtime.last_error_code, runtime.last_error_retryable
        from companies company
        inner join actors requester
          on requester.company_id = company.id
          and requester.id = ${input.requestedByMemberId}
          and requester.status = 'active'
        left join company_runtime_status runtime on runtime.company_id = company.id
        where company.id = ${input.companyId}
        limit 2
      `));
      if (rows.length === 0) {
        const authorized = rowsFromResult<{ id: string }>(await this.db.execute(sql`
          select id from actors
          where company_id = ${input.companyId}
            and id = ${input.requestedByMemberId}
            and status = 'active'
          limit 2
        `));
        if (authorized.length !== 1) {
          throw new ApplicationError(COMPANY_RUNTIME_STATUS_ACCESS_DENIED_CODE, false);
        }
        return {
          companyId: input.companyId,
          status: "pending",
          lastHeartbeatAtMs: null,
          memberAppServers: emptyMemberAppServerCounts(),
          activeExecutionCount: 0,
          error: null,
        };
      }
      if (rows.length !== 1) throw new ApplicationError(COMPANY_RUNTIME_STATUS_INVALID_CODE, false);
      return statusFromRow(rows[0]!);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(COMPANY_RUNTIME_STATUS_UNAVAILABLE_CODE, true);
    }
  }
}

function statusFromRow(row: RuntimeStatusRow): CompanyRuntimeStatus {
  const error = row.last_error_code === null
    ? null
    : {
      code: row.last_error_code,
      retryable: row.last_error_retryable ?? false,
    };
  return {
    companyId: row.company_id,
    status: runtimeStatus(row, error !== null),
    lastHeartbeatAtMs: row.last_heartbeat_at_ms === null
      ? null
      : nonNegativeNumber(row.last_heartbeat_at_ms),
    memberAppServers: memberAppServerCounts(row.status_json),
    activeExecutionCount: row.active_execution_count === null
      ? 0
      : nonNegativeNumber(row.active_execution_count),
    error,
  };
}

function emptyMemberAppServerCounts(): CompanyRuntimeStatus["memberAppServers"] {
  return { running: 0, idle: 0, switching: 0, failed: 0 };
}

function memberAppServerCounts(value: unknown): CompanyRuntimeStatus["memberAppServers"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return emptyMemberAppServerCounts();
  }
  const statuses = (value as { member_app_servers?: unknown }).member_app_servers;
  if (!Array.isArray(statuses)) return emptyMemberAppServerCounts();
  const counts = emptyMemberAppServerCounts();
  for (const status of statuses) {
    if (status === null || typeof status !== "object" || Array.isArray(status)) continue;
    const state = (status as { state?: unknown }).state;
    if (state === "ready" || state === "starting") counts.running += 1;
    else if (state === "idle" || state === "stopped") counts.idle += 1;
    else if (state === "switching") counts.switching += 1;
    else if (state === "failed" || state === "auth_required") counts.failed += 1;
  }
  return counts;
}

function runtimeStatus(
  row: RuntimeStatusRow,
  hasError: boolean,
): CompanyRuntimeStatus["status"] {
  if (
    row.company_status === "setup_failed"
    || row.runtime_state === "failed"
  ) {
    return "failed";
  }
  if (
    (row.runtime_state === "ready" || row.runtime_state === "degraded")
    && row.last_heartbeat_at_ms !== null
  ) {
    return hasError || row.runtime_state === "degraded" ? "degraded" : "ready";
  }
  if (row.runtime_state === "starting" || row.company_status === "provisioning") {
    return "provisioning";
  }
  if (row.runtime_state === "stopping") return "degraded";
  return "pending";
}

function nonNegativeNumber(value: DatabaseNumber): number {
  const result = databaseNumber(value);
  if (result < 0) throw new ApplicationError(COMPANY_RUNTIME_STATUS_INVALID_CODE, false);
  return result;
}

function databaseNumber(value: DatabaseNumber): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new ApplicationError(COMPANY_RUNTIME_STATUS_INVALID_CODE, false);
  }
  return result;
}

function rowsFromResult<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result !== null && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Row[];
  }
  return [];
}
