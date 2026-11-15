import { sql } from "drizzle-orm";

import type { Company, CompanyStatus } from "../../../../domain/company/index.js";
import type {
  CompanyAccessQuery,
  CompanyCommandRepository,
  CompanyCreationEligibilityQuery,
  CompanyOnboardingProcess,
  CompanyProductSessionQuery,
  CompanyQueryRepository,
  ProductSessionCompany,
} from "../../../../application/company/ports/index.js";
import { ApplicationError } from "../../../../application/platform/errors.js";
import type { OwnerName, OwnerTransaction } from "../../../../application/platform/ports/index.js";
import type { BackendDatabase } from "../database-service.js";


export const COMPANY_PERSISTENCE_CONFLICT_CODE = "COMPANY_PERSISTENCE_CONFLICT";
export const COMPANY_PERSISTENCE_UNAVAILABLE_CODE = "COMPANY_PERSISTENCE_UNAVAILABLE";

type DatabaseExecutor = Pick<BackendDatabase, "execute">;

/** Supplied by the PostgreSQL UoW from Composition; never exposed to Application. */
export type PostgresOwnerTransactionResolver = (
  transaction: OwnerTransaction,
  expectedOwner: OwnerName,
) => DatabaseExecutor;

type CompanyRow = {
  id: string;
  name: string;
  status: string;
  auth_organization_id: string | null;
  created_at_ms: number | string | bigint;
  updated_at_ms: number | string | bigint;
};

type CompanyOnboardingProcessRow = {
  company_id: string;
  owner_actor_id: string;
  runtime_id: string;
  executor_id: string | null;
  initial_operation_id: string;
  stage: string;
  version: number | string | bigint;
  last_error_code: string | null;
  last_error_retryable: boolean | null;
  created_at_ms: number | string | bigint;
  updated_at_ms: number | string | bigint;
};

/**
 * PostgreSQL adapter for Company facts and the Company-owned onboarding
 * projection. Command methods resolve only the private UoW capability; query
 * methods never expose Drizzle rows to Application.
 */
export class PostgresCompanyRepository implements
  CompanyCommandRepository,
  CompanyQueryRepository,
  CompanyCreationEligibilityQuery,
  CompanyProductSessionQuery,
  CompanyAccessQuery {
  constructor(
    private readonly db: BackendDatabase,
    private readonly resolveTransaction: PostgresOwnerTransactionResolver,
  ) {}

  async create(transaction: OwnerTransaction, company: Company): Promise<void> {
    try {
      const databaseTransaction = this.resolveTransaction(transaction, "company");
      await databaseTransaction.execute(sql`
        insert into companies (
          id, name, status, auth_organization_id, created_at_ms, updated_at_ms
        ) values (
          ${company.id}, ${company.name}, ${company.status}, ${company.authOrganizationId},
          ${company.createdAtMs}, ${company.updatedAtMs}
        )
      `);
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }

  async createOnboardingProcess(
    transaction: OwnerTransaction,
    process: CompanyOnboardingProcess,
  ): Promise<void> {
    try {
      const databaseTransaction = this.resolveTransaction(transaction, "company");
      await databaseTransaction.execute(sql`
        insert into company_onboarding_processes (
          company_id, owner_actor_id, runtime_id, executor_id,
          initial_operation_id, stage, version, last_error_code,
          last_error_retryable, created_at_ms, updated_at_ms
        ) values (
          ${process.companyId}, ${process.ownerActorId}, ${process.runtimeId},
          ${process.executorId}, ${process.initialOperationId},
          ${process.stage}, ${process.version}, ${process.lastErrorCode},
          ${process.lastErrorRetryable}, ${process.createdAtMs}, ${process.updatedAtMs}
        )
      `);
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }

  async transitionStatus(
    transaction: OwnerTransaction,
    companyId: string,
    status: CompanyStatus,
    updatedAtMs: number,
  ): Promise<Company | null> {
    try {
      const databaseTransaction = this.resolveTransaction(transaction, "company");
      const rows = rowsFromResult<CompanyRow>(await databaseTransaction.execute(sql`
        update companies
        set status = ${status}, updated_at_ms = ${updatedAtMs}
        where id = ${companyId}
        returning id, name, status, auth_organization_id, created_at_ms, updated_at_ms
      `));
      return rows[0] ? companyFromRow(rows[0]) : null;
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }

  async markSetupFailure(
    transaction: OwnerTransaction,
    companyId: string,
    errorCode: string,
    retryable: boolean,
    updatedAtMs: number,
  ): Promise<void> {
    try {
      const databaseTransaction = this.resolveTransaction(transaction, "company");
      assertSafeErrorCode(errorCode);
      const companyRows = rowsFromResult<{ id: string }>(await databaseTransaction.execute(sql`
        update companies
        set status = 'setup_failed', updated_at_ms = ${updatedAtMs}
        where id = ${companyId}
        returning id
      `));
      if (companyRows.length !== 1) {
        throw new ApplicationError(COMPANY_PERSISTENCE_CONFLICT_CODE, false);
      }
      const processRows = rowsFromResult<{ company_id: string }>(await databaseTransaction.execute(sql`
        update company_onboarding_processes
        set stage = 'failed', version = version + 1, last_error_code = ${errorCode},
          last_error_retryable = ${retryable}, updated_at_ms = ${updatedAtMs}
        where company_id = ${companyId}
        returning company_id
      `));
      if (processRows.length !== 1) {
        throw new ApplicationError(COMPANY_PERSISTENCE_CONFLICT_CODE, false);
      }
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }

  async beginRetry(
    transaction: OwnerTransaction,
    companyId: string,
    updatedAtMs: number,
  ): Promise<CompanyOnboardingProcess | null> {
    try {
      const databaseTransaction = this.resolveTransaction(transaction, "company");
      const companyRows = rowsFromResult<{ id: string }>(await databaseTransaction.execute(sql`
        update companies
        set status = case when exists (
          select 1 from company_runtime_status runtime
          where runtime.company_id = companies.id and runtime.state in ('ready', 'degraded')
        ) then 'active' else 'provisioning' end,
          updated_at_ms = ${updatedAtMs}
        where id = ${companyId} and status = 'setup_failed'
        returning id
      `));
      if (companyRows.length === 0) {
        return null;
      }
      if (companyRows.length !== 1) {
        throw new ApplicationError(COMPANY_PERSISTENCE_CONFLICT_CODE, false);
      }
      const processRows = rowsFromResult<CompanyOnboardingProcessRow>(await databaseTransaction.execute(sql`
        update company_onboarding_processes
        set stage = case when exists (
          select 1 from company_runtime_status runtime
          where runtime.company_id = company_onboarding_processes.company_id
            and runtime.state in ('ready', 'degraded')
        ) then 'ready' else 'creatingRuntime' end,
          version = version + 1, last_error_code = null,
          last_error_retryable = null, updated_at_ms = ${updatedAtMs}
        where company_id = ${companyId} and stage = 'failed'
        returning company_id, owner_actor_id, runtime_id, executor_id,
          initial_operation_id, stage, version, last_error_code, last_error_retryable,
          created_at_ms, updated_at_ms
      `));
      if (processRows.length !== 1 || !processRows[0]) {
        throw new ApplicationError(COMPANY_PERSISTENCE_CONFLICT_CODE, false);
      }
      return companyOnboardingProcessFromRow(processRows[0]);
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }

  async findById(companyId: string): Promise<Company | null> {
    try {
      const rows = rowsFromResult<CompanyRow>(await this.db.execute(sql`
        select id, name, status, auth_organization_id, created_at_ms, updated_at_ms
        from companies where id = ${companyId} limit 2
      `));
      return onlyCompany(rows);
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }

  async findByAuthOrganizationId(organizationId: string): Promise<Company | null> {
    try {
      const rows = rowsFromResult<CompanyRow>(await this.db.execute(sql`
        select id, name, status, auth_organization_id, created_at_ms, updated_at_ms
        from companies where auth_organization_id = ${organizationId} limit 2
      `));
      return onlyCompany(rows);
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }

  async readOnboarding(companyId: string): Promise<CompanyOnboardingProcess | null> {
    try {
      const rows = rowsFromResult<CompanyOnboardingProcessRow>(await this.db.execute(sql`
        select company_id, owner_actor_id, runtime_id, executor_id,
          initial_operation_id, stage, version, last_error_code, last_error_retryable,
          created_at_ms, updated_at_ms
        from company_onboarding_processes where company_id = ${companyId} limit 2
      `));
      if (rows.length > 1) {
        throw new ApplicationError(COMPANY_PERSISTENCE_CONFLICT_CODE, false);
      }
      return rows[0] ? companyOnboardingProcessFromRow(rows[0]) : null;
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }

  async requireActiveCompany(companyId: string): Promise<{ companyId: string; status: "active" }> {
    try {
      const rows = rowsFromResult<{ id: string }>(await this.db.execute(sql`
        select id from companies where id = ${companyId} and status = 'active' limit 2
      `));
      if (rows.length !== 1) {
        throw new ApplicationError(COMPANY_PERSISTENCE_CONFLICT_CODE, false);
      }
      return { companyId: rows[0].id, status: "active" };
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }

  async findCompanyIdForAuthUser(authUserId: string): Promise<string | null> {
    try {
      const rows = rowsFromResult<{ company_id: string }>(await this.db.execute(sql`
        select company.id as company_id
        from "member" membership
        join companies company on company.auth_organization_id = membership.organization_id
        where membership.user_id = ${authUserId}
        order by company.id asc
        limit 2
      `));
      return rows[0]?.company_id ?? null;
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }

  async isCompanyCreationAvailable(): Promise<boolean> {
    try {
      const rows = rowsFromResult<{ id: string }>(await this.db.execute(sql`
        select id from companies limit 1
      `));
      return rows.length === 0;
    } catch {
      throw new ApplicationError(COMPANY_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async findForProductSession(companyId: string): Promise<ProductSessionCompany | null> {
    try {
      const rows = rowsFromResult<{
        id: string;
        auth_organization_id: string | null;
        status: string;
      }>(await this.db.execute(sql`
        select id, auth_organization_id, status from companies where id = ${companyId} limit 2
      `));
      if (rows.length > 1) {
        throw new ApplicationError(COMPANY_PERSISTENCE_CONFLICT_CODE, false);
      }
      const row = rows[0];
      if (!row || !row.auth_organization_id) {
        return null;
      }
      return {
        companyId: row.id,
        authOrganizationId: row.auth_organization_id,
        status: companyStatusFromDb(row.status),
      };
    } catch (error) {
      throw companyPersistenceError(error);
    }
  }
}

function onlyCompany(rows: readonly CompanyRow[]): Company | null {
  if (rows.length > 1) {
    throw new ApplicationError(COMPANY_PERSISTENCE_CONFLICT_CODE, false);
  }
  return rows[0] ? companyFromRow(rows[0]) : null;
}

function companyFromRow(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    status: companyStatusFromDb(row.status),
    authOrganizationId: row.auth_organization_id,
    createdAtMs: nonNegativeNumberFromDb(row.created_at_ms),
    updatedAtMs: nonNegativeNumberFromDb(row.updated_at_ms),
  };
}

function companyOnboardingProcessFromRow(row: CompanyOnboardingProcessRow): CompanyOnboardingProcess {
  return {
    companyId: row.company_id,
    ownerActorId: row.owner_actor_id,
    runtimeId: row.runtime_id,
    executorId: row.executor_id,
    initialOperationId: row.initial_operation_id,
    stage: companyOnboardingStageFromDb(row.stage),
    version: nonNegativeNumberFromDb(row.version),
    lastErrorCode: row.last_error_code,
    lastErrorRetryable: row.last_error_retryable,
    createdAtMs: nonNegativeNumberFromDb(row.created_at_ms),
    updatedAtMs: nonNegativeNumberFromDb(row.updated_at_ms),
  };
}

function companyStatusFromDb(value: string): CompanyStatus {
  if (value === "provisioning" || value === "active" || value === "setup_failed") {
    return value;
  }
  throw new ApplicationError(COMPANY_PERSISTENCE_UNAVAILABLE_CODE, true);
}

function companyOnboardingStageFromDb(value: string): CompanyOnboardingProcess["stage"] {
  if (
    value === "creatingRuntime"
    || value === "initializingRuntime"
    || value === "failed"
    || value === "ready"
  ) {
    return value;
  }
  throw new ApplicationError(COMPANY_PERSISTENCE_UNAVAILABLE_CODE, true);
}

function nonNegativeNumberFromDb(value: number | string | bigint): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new ApplicationError(COMPANY_PERSISTENCE_UNAVAILABLE_CODE, true);
  }
  return normalized;
}

function assertSafeErrorCode(value: string): void {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(value)) {
    throw new ApplicationError(COMPANY_PERSISTENCE_CONFLICT_CODE, false);
  }
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }
  return [];
}

function companyPersistenceError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }
  const code = postgresCode(error);
  return new ApplicationError(
    code === "23505" ? COMPANY_PERSISTENCE_CONFLICT_CODE : COMPANY_PERSISTENCE_UNAVAILABLE_CODE,
    code !== "23505",
  );
}

function postgresCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  if ("cause" in error && typeof error.cause === "object" && error.cause !== null) {
    const cause = error.cause;
    if ("code" in cause && typeof cause.code === "string") {
      return cause.code;
    }
  }
  return null;
}
