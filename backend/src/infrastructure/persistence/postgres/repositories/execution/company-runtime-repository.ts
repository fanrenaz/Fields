import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  CompanyExecutorCredentialUpdatedInput,
  CompanyExecutorUnavailableInput,
  CompanyRuntimeFailedInput,
  CompanyRuntimeHeartbeatInput,
  CompanyRuntimeIdentity,
} from "@fields/contracts/internal/company-runtime";
import { sql } from "drizzle-orm";

import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";

export const COMPANY_RUNTIME_ACCESS_DENIED_CODE = "COMPANY_RUNTIME_ACCESS_DENIED";
export const COMPANY_RUNTIME_SCOPE_INVALID_CODE = "COMPANY_RUNTIME_SCOPE_INVALID";
export const COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE = "COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE";

type DatabaseNumber = number | string | bigint;

export type ReadyCompanyRuntime = CompanyRuntimeIdentity & {
  runtimeUrl: string;
};

export type FixedCompanyRuntimeOptions = {
  companyId: string;
  runtimeUrl: string;
  controlTokenFile: string;
};

export function fixedCompanyRuntimeOptionsFromEnv(env: NodeJS.ProcessEnv): FixedCompanyRuntimeOptions {
  return {
    companyId: requiredEnv(env, "FIELDS_INTERNAL_COMPANY_ID"),
    runtimeUrl: requiredEnv(env, "FIELDS_COMPANY_RUNTIME_URL"),
    controlTokenFile: requiredEnv(env, "FIELDS_INTERNAL_CONTROL_TOKEN_FILE"),
  };
}

export class PostgresCompanyRuntimeRepository {
  constructor(
    private readonly db: BackendDatabase,
    private readonly options: FixedCompanyRuntimeOptions,
  ) {}

  async resolveReady(companyId: string): Promise<ReadyCompanyRuntime> {
    if (companyId !== this.options.companyId || !this.options.runtimeUrl) {
      throw new ApplicationError(COMPANY_RUNTIME_SCOPE_INVALID_CODE, false);
    }
    return { company_id: companyId, runtimeUrl: this.options.runtimeUrl };
  }

  async authorize(identity: CompanyRuntimeIdentity, bearerToken: string): Promise<void> {
    try {
      const controlToken = (await readFile(this.options.controlTokenFile, "utf8")).trim();
      if (identity.company_id !== this.options.companyId || !matchesToken(bearerToken, controlToken)) {
        throw new ApplicationError(COMPANY_RUNTIME_ACCESS_DENIED_CODE, false);
      }
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async recordReady(identity: CompanyRuntimeIdentity, nowMs: number): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const company = rowsFromResult<{ id: string }>(await transaction.execute(sql`
        select id from companies where id = ${identity.company_id} for update
      `));
      requireSingleUpdate(company);
      await transaction.execute(sql`
        insert into company_runtime_status (
          company_id, state, active_member_server_count, active_execution_count,
          status_json, last_error_code, last_error_retryable, observed_at_ms, updated_at_ms
        ) values (
          ${identity.company_id}, 'ready', 0, 0, '{"member_app_servers":[]}'::jsonb,
          null, null, ${nowMs}, ${nowMs}
        )
        on conflict (company_id) do update
        set state = 'ready', last_error_code = null, last_error_retryable = null,
          observed_at_ms = excluded.observed_at_ms, updated_at_ms = excluded.updated_at_ms
      `);
      await transaction.execute(sql`
        update company_onboarding_processes
        set stage = 'ready', version = version + 1,
          last_error_code = null, last_error_retryable = null,
          updated_at_ms = ${nowMs}
        where company_id = ${identity.company_id}
          and stage in ('creatingRuntime', 'initializingRuntime')
      `);
      await transaction.execute(sql`
        update companies
        set status = 'active', updated_at_ms = ${nowMs}
        where id = ${identity.company_id}
          and status = 'provisioning'
      `);
    });
  }

  async recordHeartbeat(input: CompanyRuntimeHeartbeatInput): Promise<void> {
    try {
      await this.db.transaction(async (transaction) => {
        const company = rowsFromResult<{ id: string }>(await transaction.execute(sql`
          select id from companies where id = ${input.company_id} for update
        `));
        requireSingleUpdate(company);
        await transaction.execute(sql`
          insert into company_runtime_status (
            company_id, state, active_member_server_count, active_execution_count,
            status_json, last_error_code, last_error_retryable, observed_at_ms, updated_at_ms
          ) values (
            ${input.company_id}, ${input.state},
            ${input.member_app_servers.length}, ${input.active_execution_count},
            ${JSON.stringify({ state: input.state, member_app_servers: input.member_app_servers })}::jsonb,
            null, null, ${input.occurred_at_ms}, ${input.occurred_at_ms}
          )
          on conflict (company_id) do update
          set state = excluded.state,
            active_member_server_count = excluded.active_member_server_count,
            active_execution_count = excluded.active_execution_count,
            status_json = excluded.status_json,
            last_error_code = null,
            last_error_retryable = null,
            observed_at_ms = excluded.observed_at_ms,
            updated_at_ms = excluded.updated_at_ms
        `);
        if (input.state === "ready" || input.state === "degraded") {
          await promoteCompany(transaction, input.company_id, input.occurred_at_ms);
        }
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async recordFailed(input: CompanyRuntimeFailedInput): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const company = rowsFromResult<{ id: string }>(await transaction.execute(sql`
        select id from companies where id = ${input.company_id} for update
      `));
      requireSingleUpdate(company);
      await transaction.execute(sql`
        insert into company_runtime_status (
          company_id, state, active_member_server_count, active_execution_count,
          status_json, last_error_code, last_error_retryable, observed_at_ms, updated_at_ms
        ) values (
          ${input.company_id}, 'failed', 0, 0, '{"member_app_servers":[]}'::jsonb,
          ${input.error.code}, ${input.error.retryable}, ${input.occurred_at_ms}, ${input.occurred_at_ms}
        )
        on conflict (company_id) do update
        set state = 'failed', last_error_code = excluded.last_error_code,
          last_error_retryable = excluded.last_error_retryable,
          observed_at_ms = excluded.observed_at_ms, updated_at_ms = excluded.updated_at_ms
      `);
      await transaction.execute(sql`
        update company_onboarding_processes
        set stage = 'failed', version = version + 1,
          last_error_code = ${input.error.code},
          last_error_retryable = ${input.error.retryable},
          updated_at_ms = ${input.occurred_at_ms}
        where company_id = ${input.company_id}
          and stage <> 'ready'
      `);
      await transaction.execute(sql`
        update companies
        set status = 'setup_failed', updated_at_ms = ${input.occurred_at_ms}
        where id = ${input.company_id}
          and status = 'provisioning'
      `);
    });
  }

  async recordCredentialUpdated(input: CompanyExecutorCredentialUpdatedInput): Promise<void> {
    try {
      const accountId = input.authorization.method === "chatgpt"
        ? input.authorization.account_id
        : null;
      const planType = input.authorization.method === "chatgpt"
        ? input.authorization.plan_type
        : null;
      const endpointHost = input.authorization.method === "custom_api_key"
        ? input.authorization.endpoint_host
        : null;
      const rows = rowsFromResult<{ executor_id: string }>(await this.db.execute(sql`
        update company_executors
        set status = 'connected', credential_version = ${input.credential_version},
          account_id = ${accountId}, plan_type = ${planType},
          endpoint_host = ${endpointHost},
          connected_at_ms = coalesce(connected_at_ms, ${input.occurred_at_ms}),
          revoked_at_ms = null, last_error_code = null,
          last_error_retryable = null, updated_at_ms = ${input.occurred_at_ms}
        where company_id = ${input.company_id}
          and executor_id = ${input.executor_id}
          and authorization_method = ${input.authorization.method}
          and credential_version < ${input.credential_version}
        returning executor_id
      `));
      if (rows.length === 0) {
        const current = rowsFromResult<{ credential_version: DatabaseNumber; authorization_method: string }>(await this.db.execute(sql`
          select credential_version, authorization_method from company_executors
          where company_id = ${input.company_id}
            and executor_id = ${input.executor_id}
          limit 2
        `));
        if (
          current.length !== 1
          || positiveNumber(current[0]!.credential_version) !== input.credential_version
          || current[0]!.authorization_method !== input.authorization.method
        ) {
          throw new ApplicationError(COMPANY_RUNTIME_SCOPE_INVALID_CODE, false);
        }
      }
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async recordExecutorUnavailable(input: CompanyExecutorUnavailableInput): Promise<void> {
    try {
      await this.db.transaction(async (transaction) => {
        const rows = rowsFromResult<{ executor_id: string }>(await transaction.execute(sql`
          update company_executors
          set status = ${input.reason === "expired"
            ? "expired"
            : input.reason === "invalid_credentials" || input.reason === "runtime_failed"
              ? "failed"
              : "revoked"},
            revoked_at_ms = ${input.occurred_at_ms},
            last_error_code = ${input.reason},
            last_error_retryable = ${input.reason === "runtime_failed"},
            updated_at_ms = ${input.occurred_at_ms}
          where company_id = ${input.company_id}
            and executor_id = ${input.executor_id}
            and credential_version = ${input.credential_version}
          returning executor_id
        `));
        requireSingleUpdate(rows);
        await transaction.execute(sql`
          update member_executor_assignments
          set state = 'auth_required',
            last_error_code = ${input.reason},
            last_error_retryable = false,
            updated_at_ms = ${input.occurred_at_ms}
          where company_id = ${input.company_id}
            and executor_id = ${input.executor_id}
            and state <> 'switching'
        `);
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

}

function matchesToken(token: string, expectedToken: string): boolean {
  if (!token || !expectedToken) return false;
  const actual = Buffer.from(token, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function requireSingleUpdate(rows: readonly unknown[]): void {
  if (rows.length !== 1) throw new ApplicationError(COMPANY_RUNTIME_SCOPE_INVALID_CODE, false);
}

function positiveNumber(value: DatabaseNumber): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ApplicationError(COMPANY_RUNTIME_SCOPE_INVALID_CODE, false);
  }
  return result;
}

async function promoteCompany(
  transaction: BackendDatabase,
  companyId: string,
  nowMs: number,
): Promise<void> {
  await transaction.execute(sql`
    update company_onboarding_processes
    set stage = 'ready', version = version + 1,
      last_error_code = null, last_error_retryable = null, updated_at_ms = ${nowMs}
    where company_id = ${companyId}
      and stage in ('creatingRuntime', 'initializingRuntime', 'failed')
  `);
  await transaction.execute(sql`
    update companies set status = 'active', updated_at_ms = ${nowMs}
    where id = ${companyId} and status in ('provisioning', 'setup_failed')
  `);
}

function rowsFromResult<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result !== null && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Row[];
  }
  return [];
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
