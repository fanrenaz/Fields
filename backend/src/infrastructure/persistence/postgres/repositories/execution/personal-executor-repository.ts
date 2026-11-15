import { randomUUID } from "node:crypto";

import type {
  CompanyExecutorSafeListResult,
  CompanyExecutorSharingGovernanceResult,
  ExecutorDeleteResult,
  ExecutorAuthorizationMethod,
  ExecutorCustomApiConfigureInput,
  ExecutorDeviceAuthorizationCancelResult,
  ExecutorDeviceAuthorizationStartResult,
  ExecutorDeviceAuthorizationStatusResult,
  ExecutorModelCatalogResult,
  ExecutorModelPolicy,
  ExecutorModelPolicyResult,
  ExecutorModelPolicyUpdateInput,
  ExecutorModelValidationInput,
  ExecutorModelValidationResult,
  PersonalExecutorMutationResult,
  PersonalExecutorsListResult,
  PersonalExecutorUsageResult,
} from "@fields/contracts/public/executor";
import {
  executorAuthorizationRuntimeUnavailableCode,
} from "@fields/contracts/public/executor";
import { sql } from "drizzle-orm";

import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { TrpcCompanyRuntimeGateway } from "../../../../runtime/company-runtime/index.js";
import type { BackendDatabase } from "../../database-service.js";
import {
  COMPANY_RUNTIME_SCOPE_INVALID_CODE,
  COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE,
} from "./company-runtime-repository.js";

type DatabaseNumber = number | string | bigint;
type ExecutorRow = {
  executor_id: string;
  owner_member_id: string;
  owner_display_name: string;
  name: string;
  executor_type: string;
  authorization_method: string;
  configuration_status: string;
  configuration_revision: DatabaseNumber;
  allowed_models_json: unknown;
  allowed_reasoning_efforts_json: unknown;
  default_model: string | null;
  default_reasoning_effort: string | null;
  catalog_checked_at_ms: DatabaseNumber | null;
  configuration_updated_at_ms: DatabaseNumber | null;
  sharing_state: string;
  status: string;
  account_id: string | null;
  plan_type: string | null;
  endpoint_host: string | null;
  credential_version: DatabaseNumber;
  connected_at_ms: DatabaseNumber | null;
  updated_at_ms: DatabaseNumber;
};

export class PostgresPersonalExecutorRepository {
  constructor(
    private readonly db: BackendDatabase,
    private readonly runtime: TrpcCompanyRuntimeGateway,
    private readonly now: () => number,
  ) {}

  async list(companyId: string, memberId: string): Promise<PersonalExecutorsListResult> {
    return { items: (await this.ownedRows(companyId, memberId)).map(personalSummary) };
  }

  async create(
    companyId: string,
    memberId: string,
    name: string,
    authorizationMethod: ExecutorAuthorizationMethod,
  ): Promise<PersonalExecutorMutationResult> {
    const executorId = `executor_${randomUUID()}`;
    const nowMs = this.now();
    const rows = rowsFromResult<ExecutorRow>(await this.db.execute(sql`
      with inserted as (
        insert into company_executors (
          executor_id, company_id, owner_member_id, name, executor_type, authorization_method, sharing_state,
          status, credential_version, created_at_ms, updated_at_ms
        ) values (
          ${executorId}, ${companyId}, ${memberId}, ${requiredName(name)}, 'codex',
          ${authorizationMethod}, 'private', 'pending_auth', 0, ${nowMs}, ${nowMs}
        )
        returning *
      )
      select inserted.executor_id, inserted.owner_member_id,
        owner.display_name as owner_display_name, inserted.name, inserted.executor_type,
        inserted.authorization_method, inserted.configuration_status, inserted.configuration_revision,
        inserted.allowed_models_json, inserted.allowed_reasoning_efforts_json,
        inserted.default_model, inserted.default_reasoning_effort,
        inserted.catalog_checked_at_ms, inserted.configuration_updated_at_ms,
        inserted.sharing_state, inserted.status, inserted.account_id,
        inserted.plan_type, inserted.endpoint_host, inserted.credential_version,
        inserted.connected_at_ms, inserted.updated_at_ms
      from inserted
      inner join actors owner on owner.id = inserted.owner_member_id
        and owner.company_id = inserted.company_id
    `));
    return { executor: personalSummary(requiredRow(rows)) };
  }

  async rename(
    companyId: string,
    memberId: string,
    executorId: string,
    name: string,
  ): Promise<PersonalExecutorMutationResult> {
    const row = await this.updateOwned(companyId, memberId, executorId, sql`
      name = ${requiredName(name)}, updated_at_ms = ${this.now()}
    `);
    return { executor: personalSummary(row) };
  }

  async authorizationStart(
    companyId: string,
    memberId: string,
    executorId: string,
  ): Promise<ExecutorDeviceAuthorizationStartResult> {
    const owned = await this.requireOwned(companyId, memberId, executorId);
    requireAuthorizationMethod(owned, "chatgpt");
    const attemptId = `executor_attempt_${randomUUID()}`;
    let result: Awaited<ReturnType<TrpcCompanyRuntimeGateway["authStart"]>>;
    try {
      result = await this.runtime.authStart(companyId, {
        executor_id: executorId,
        attempt_id: attemptId,
      });
    } catch (error) {
      if (
        error instanceof ApplicationError
        && (
          error.code === COMPANY_RUNTIME_SCOPE_INVALID_CODE
          || error.code === COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE
        )
      ) {
        throw new ApplicationError(executorAuthorizationRuntimeUnavailableCode, true);
      }
      throw error;
    }
    const nowMs = this.now();
    await this.db.execute(sql`
      insert into executor_auth_attempts (
        attempt_id, company_id, executor_id, status, created_at_ms, updated_at_ms
      ) values (${attemptId}, ${companyId}, ${executorId}, 'pending', ${nowMs}, ${nowMs})
    `);
    return {
      executor_id: executorId,
      attempt_id: result.attempt_id,
      verification_url: result.verification_url,
      user_code: result.user_code,
    };
  }

  async authorizationStatus(
    companyId: string,
    memberId: string,
    executorId: string,
    attemptId: string,
  ): Promise<ExecutorDeviceAuthorizationStatusResult> {
    const owned = await this.requireOwned(companyId, memberId, executorId);
    requireAuthorizationMethod(owned, "chatgpt");
    const result = await this.runtime.authStatus(companyId, {
      executor_id: executorId,
      attempt_id: attemptId,
    });
    await this.db.execute(sql`
      update executor_auth_attempts
      set status = ${result.status}, last_error_code = ${result.error?.code ?? null},
        last_error_retryable = ${result.error?.retryable ?? null},
        updated_at_ms = ${this.now()}
      where attempt_id = ${attemptId}
        and company_id = ${companyId}
        and executor_id = ${executorId}
    `);
    return {
      executor_id: executorId,
      attempt_id: attemptId,
      status: result.status,
      error_code: result.error?.code ?? null,
      retryable: result.error?.retryable ?? false,
    };
  }

  async authorizationCancel(
    companyId: string,
    memberId: string,
    executorId: string,
    attemptId: string,
  ): Promise<ExecutorDeviceAuthorizationCancelResult> {
    const owned = await this.requireOwned(companyId, memberId, executorId);
    requireAuthorizationMethod(owned, "chatgpt");
    await this.runtime.authCancel(companyId, { executor_id: executorId, attempt_id: attemptId });
    await this.db.execute(sql`
      update executor_auth_attempts set status = 'cancelled', updated_at_ms = ${this.now()}
      where attempt_id = ${attemptId} and company_id = ${companyId} and executor_id = ${executorId}
    `);
    return { executor_id: executorId, attempt_id: attemptId, status: "cancelled" };
  }

  async configureCustomAuthorization(
    companyId: string,
    memberId: string,
    input: ExecutorCustomApiConfigureInput,
  ): Promise<PersonalExecutorMutationResult> {
    const owned = await this.requireOwned(companyId, memberId, input.executor_id);
    requireAuthorizationMethod(owned, "custom_api_key");
    let configured: Awaited<ReturnType<TrpcCompanyRuntimeGateway["configureCustomCredential"]>>;
    try {
      configured = await this.runtime.configureCustomCredential(companyId, {
        executor_id: input.executor_id,
        base_url: input.base_url,
        api_key: input.api_key,
        previous_credential_version: number(owned.credential_version),
      });
    } catch (error) {
      if (
        error instanceof ApplicationError
        && (
          error.code === COMPANY_RUNTIME_SCOPE_INVALID_CODE
          || error.code === COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE
        )
      ) {
        throw new ApplicationError(executorAuthorizationRuntimeUnavailableCode, true);
      }
      throw error;
    }
    const row = await this.updateOwned(companyId, memberId, input.executor_id, sql`
      status = 'connected',
      credential_version = ${configured.credential_version},
      account_id = null,
      plan_type = null,
      endpoint_host = ${configured.endpoint_host},
      connected_at_ms = coalesce(connected_at_ms, ${this.now()}),
      revoked_at_ms = null,
      last_error_code = null,
      last_error_retryable = null,
      updated_at_ms = ${this.now()}
    `);
    return { executor: personalSummary(row) };
  }

  async disconnect(
    companyId: string,
    memberId: string,
    executorId: string,
  ): Promise<PersonalExecutorMutationResult> {
    await this.requireOwned(companyId, memberId, executorId);
    await this.runtime.cleanupCredential(companyId, { executor_id: executorId });
    const row = await this.updateOwned(companyId, memberId, executorId, sql`
      status = 'revoked', account_id = null, plan_type = null, endpoint_host = null,
      revoked_at_ms = ${this.now()}, updated_at_ms = ${this.now()}
    `);
    return { executor: personalSummary(row) };
  }

  async setSharing(
    companyId: string,
    memberId: string,
    executorId: string,
    shared: boolean,
  ): Promise<PersonalExecutorMutationResult> {
    const row = await this.updateOwned(companyId, memberId, executorId, sql`
      sharing_state = ${shared ? "company_shared" : "private"},
      updated_at_ms = ${this.now()}
    `);
    return { executor: personalSummary(row) };
  }

  async modelCatalog(
    companyId: string,
    memberId: string,
    executorId: string,
  ): Promise<ExecutorModelCatalogResult> {
    const owned = await this.requireOwned(companyId, memberId, executorId);
    requireConnected(owned);
    const result = await this.runtime.executorModelCatalog(companyId, { executor_id: executorId });
    const checkedAtMs = this.now();
    await this.updateOwned(companyId, memberId, executorId, sql`
      catalog_checked_at_ms = ${checkedAtMs}, updated_at_ms = ${checkedAtMs}
    `);
    return {
      executor_id: executorId,
      items: result.items,
      catalog_state: "live",
      checked_at_ms: checkedAtMs,
    };
  }

  async validateModels(
    companyId: string,
    memberId: string,
    input: ExecutorModelValidationInput,
  ): Promise<ExecutorModelValidationResult> {
    const owned = await this.requireOwned(companyId, memberId, input.executor_id);
    requireConnected(owned);
    return this.runtime.executorModelsValidate(companyId, input);
  }

  async modelPolicy(
    companyId: string,
    memberId: string,
    executorId: string,
  ): Promise<ExecutorModelPolicyResult> {
    const row = await this.requireOwned(companyId, memberId, executorId);
    return { executor_id: executorId, policy: modelPolicy(row) };
  }

  async configureModelPolicy(
    companyId: string,
    memberId: string,
    input: ExecutorModelPolicyUpdateInput,
  ): Promise<ExecutorModelPolicyResult> {
    await this.requireOwned(companyId, memberId, input.executor_id);
    const available = input.models.filter((item) => item.validation_status === "available");
    if (available.length !== input.models.length) {
      throw new ApplicationError("EXECUTOR_MODEL_VALIDATION_REQUIRED", false);
    }
    const selectedDefault = available.find((item) => item.model === input.default_model);
    if (!selectedDefault) throw new ApplicationError("EXECUTOR_DEFAULT_MODEL_INVALID", false);
    const defaultEffort = input.default_reasoning_effort;
    if (defaultEffort !== null && (
      !input.allowed_reasoning_efforts.includes(defaultEffort)
      || available.some((item) => !item.supported_reasoning_efforts.includes(defaultEffort))
    )) {
      throw new ApplicationError("EXECUTOR_DEFAULT_REASONING_EFFORT_INVALID", false);
    }
    const nowMs = this.now();
    return this.db.transaction(async (transaction) => {
      const updated = rowsFromResult<{ executor_id: string }>(await transaction.execute(sql`
        update company_executors set
          configuration_status = 'ready',
          configuration_revision = configuration_revision + 1,
          allowed_models_json = ${JSON.stringify(input.models)}::jsonb,
          allowed_reasoning_efforts_json = ${JSON.stringify(input.allowed_reasoning_efforts)}::jsonb,
          default_model = ${input.default_model},
          default_reasoning_effort = ${input.default_reasoning_effort},
          configuration_updated_at_ms = ${nowMs},
          updated_at_ms = ${nowMs}
        where company_id = ${companyId}
          and owner_member_id = ${memberId}
          and executor_id = ${input.executor_id}
          and configuration_revision = ${input.expected_revision}
        returning executor_id
      `));
      if (updated.length !== 1) {
        throw new ApplicationError("EXECUTOR_CONFIGURATION_CONFLICT", true);
      }
      await transaction.execute(sql`
        update member_executor_assignments
        set state = 'ready', last_error_code = null, last_error_retryable = null,
          updated_at_ms = ${nowMs}
        where company_id = ${companyId} and executor_id = ${input.executor_id}
          and state = 'configuration_required'
      `);
      const row = requiredRow(await this.rows(sql`
        where executor.company_id = ${companyId}
          and executor.owner_member_id = ${memberId}
          and executor.executor_id = ${input.executor_id}
        limit 2
      `, transaction));
      return { executor_id: input.executor_id, policy: modelPolicy(row) };
    });
  }

  async usage(
    companyId: string,
    memberId: string,
    executorId: string,
  ): Promise<PersonalExecutorUsageResult> {
    await this.requireOwned(companyId, memberId, executorId);
    const rows = rowsFromResult<{
      member_id: string;
      display_name: string;
      type: "human" | "agent";
    }>(await this.db.execute(sql`
      select actor.id as member_id, actor.display_name, actor.type
      from member_executor_assignments assignment
      inner join actors actor on actor.company_id = assignment.company_id
        and actor.id = assignment.member_id
      where assignment.company_id = ${companyId}
        and assignment.executor_id = ${executorId}
      order by actor.display_name asc, actor.id asc
    `));
    return {
      executor_id: executorId,
      items: rows.map((row) => ({
        type: "member",
        member_id: row.member_id,
        member_name: row.display_name,
        member_type: row.type,
      })),
    };
  }

  async delete(
    companyId: string,
    memberId: string,
    executorId: string,
  ): Promise<ExecutorDeleteResult> {
    await this.requireOwned(companyId, memberId, executorId);
    if ((await this.usage(companyId, memberId, executorId)).items.length > 0) {
      throw new ApplicationError("EXECUTOR_IN_USE", false);
    }
    await this.runtime.cleanupCredential(companyId, { executor_id: executorId });
    const rows = rowsFromResult<{ executor_id: string }>(await this.db.execute(sql`
      delete from company_executors executor
      where executor.company_id = ${companyId}
        and executor.owner_member_id = ${memberId}
        and executor.executor_id = ${executorId}
        and not exists (
          select 1 from member_executor_assignments assignment
          where assignment.company_id = executor.company_id
            and (
              assignment.executor_id = executor.executor_id
              or assignment.pending_executor_id = executor.executor_id
              or assignment.previous_executor_id = executor.executor_id
            )
        )
      returning executor_id
    `));
    requiredRow(rows);
    return { executor_id: executorId, deleted: true };
  }

  async sharedPool(
    companyId: string,
    requestedByMemberId: string,
  ): Promise<CompanyExecutorSafeListResult> {
    await requireCompanyOwner(this.db, companyId, requestedByMemberId);
    const rows = await this.rows(sql`
      where executor.company_id = ${companyId}
        and executor.sharing_state in ('company_shared', 'admin_blocked')
      order by executor.updated_at_ms desc
    `);
    return {
      items: rows.map((row) => ({
        ...safeSummary(row),
        sharing_status: row.sharing_state as "company_shared" | "admin_blocked",
      })),
    };
  }

  async governSharing(
    companyId: string,
    requestedByMemberId: string,
    executorId: string,
    blocked: boolean,
  ): Promise<CompanyExecutorSharingGovernanceResult> {
    await requireCompanyOwner(this.db, companyId, requestedByMemberId);
    const rows = await this.rows(sql`
      where executor.company_id = ${companyId}
        and executor.executor_id = ${executorId}
      limit 2
    `);
    const current = requiredRow(rows);
    const sharing = blocked ? "admin_blocked" : "company_shared";
    await this.db.execute(sql`
      update company_executors set sharing_state = ${sharing}, updated_at_ms = ${this.now()}
      where company_id = ${companyId} and executor_id = ${executorId}
    `);
    return { executor: safeSummary(current), sharing_status: sharing };
  }

  private async requireOwned(companyId: string, memberId: string, executorId: string): Promise<ExecutorRow> {
    return requiredRow(await this.rows(sql`
      where executor.company_id = ${companyId}
        and executor.owner_member_id = ${memberId}
        and executor.executor_id = ${executorId}
      limit 2
    `));
  }

  private async ownedRows(companyId: string, memberId: string): Promise<ExecutorRow[]> {
    return this.rows(sql`
      where executor.company_id = ${companyId}
        and executor.owner_member_id = ${memberId}
      order by executor.updated_at_ms desc
    `);
  }

  private async updateOwned(
    companyId: string,
    memberId: string,
    executorId: string,
    set: ReturnType<typeof sql>,
  ): Promise<ExecutorRow> {
    await this.db.execute(sql`
      update company_executors set ${set}
      where company_id = ${companyId}
        and owner_member_id = ${memberId}
        and executor_id = ${executorId}
    `);
    return this.requireOwned(companyId, memberId, executorId);
  }

  private async rows(
    where: ReturnType<typeof sql>,
    database: Pick<BackendDatabase, "execute"> = this.db,
  ): Promise<ExecutorRow[]> {
    return rowsFromResult<ExecutorRow>(await database.execute(sql`
      select executor.executor_id, executor.owner_member_id,
        owner.display_name as owner_display_name, executor.name, executor.executor_type,
        executor.authorization_method, executor.configuration_status,
        executor.configuration_revision, executor.allowed_models_json,
        executor.allowed_reasoning_efforts_json, executor.default_model,
        executor.default_reasoning_effort, executor.catalog_checked_at_ms,
        executor.configuration_updated_at_ms,
        executor.sharing_state, executor.status, executor.account_id,
        executor.plan_type, executor.endpoint_host, executor.credential_version,
        executor.connected_at_ms, executor.updated_at_ms
      from company_executors executor
      inner join actors owner on owner.company_id = executor.company_id
        and owner.id = executor.owner_member_id
      ${where}
    `));
  }
}

function personalSummary(row: ExecutorRow): PersonalExecutorsListResult["items"][number] {
  return {
    ...safeSummary(row),
    authorization: ownerAuthorization(row),
    sharing_status: sharingState(row.sharing_state),
    credential_version: number(row.credential_version),
    connected_at_ms: row.connected_at_ms === null ? null : number(row.connected_at_ms),
    updated_at_ms: number(row.updated_at_ms),
  };
}

function safeSummary(row: ExecutorRow) {
  return {
    executor_id: row.executor_id,
    scope: "personal" as const,
    executor_type: executorType(row.executor_type),
    binding_method: row.authorization_method === "chatgpt" ? "device_code" as const : "api_key" as const,
    owner_actor_id: row.owner_member_id,
    owner_display_name: row.owner_display_name,
    name: row.name,
    authorization: safeAuthorization(row),
    availability: availability(row.status, row.configuration_status),
    model_policy: modelPolicy(row),
  };
}

function modelPolicy(row: ExecutorRow): ExecutorModelPolicy {
  const models = Array.isArray(row.allowed_models_json) ? row.allowed_models_json : [];
  const efforts = Array.isArray(row.allowed_reasoning_efforts_json)
    ? row.allowed_reasoning_efforts_json.filter((value): value is string => typeof value === "string")
    : [];
  return {
    revision: number(row.configuration_revision),
    status: configurationStatus(row.configuration_status),
    models: models as ExecutorModelPolicy["models"],
    allowed_reasoning_efforts: efforts,
    default_model: row.default_model,
    default_reasoning_effort: row.default_reasoning_effort,
    catalog_checked_at_ms: row.catalog_checked_at_ms === null ? null : number(row.catalog_checked_at_ms),
    updated_at_ms: row.configuration_updated_at_ms === null ? null : number(row.configuration_updated_at_ms),
  };
}

function executorType(value: string): "codex" {
  if (value === "codex") return value;
  throw invalid();
}

function configurationStatus(value: string): ExecutorModelPolicy["status"] {
  if (value === "pending" || value === "validating" || value === "ready" || value === "invalid") return value;
  throw invalid();
}

function ownerAuthorization(
  row: ExecutorRow,
): PersonalExecutorsListResult["items"][number]["authorization"] {
  if (row.authorization_method === "chatgpt") {
    return {
      method: "chatgpt",
      account_id: row.account_id,
      plan_type: row.plan_type,
    };
  }
  if (row.authorization_method === "custom_api_key") {
    return { method: "custom_api_key", endpoint_host: row.endpoint_host };
  }
  throw invalid();
}

function safeAuthorization(row: ExecutorRow) {
  if (row.authorization_method === "chatgpt") {
    return { method: "chatgpt" as const, plan_type: row.plan_type };
  }
  if (row.authorization_method === "custom_api_key") {
    return { method: "custom_api_key" as const };
  }
  throw invalid();
}

function requireAuthorizationMethod(row: ExecutorRow, expected: ExecutorAuthorizationMethod): void {
  if (row.authorization_method !== expected) {
    throw new ApplicationError("EXECUTOR_AUTH_METHOD_MISMATCH", false);
  }
}

function sharingState(value: string): "private" | "company_shared" | "admin_blocked" {
  if (value === "private" || value === "company_shared" || value === "admin_blocked") return value;
  throw invalid();
}

function availability(value: string, configuration: string): "available" | "pending_auth" | "configuration_required" | "unavailable" | "disconnected" {
  if (value === "connected" && configuration !== "ready") return "configuration_required";
  if (value === "connected") return "available";
  if (value === "pending_auth") return "pending_auth";
  if (value === "revoked") return "disconnected";
  return "unavailable";
}

function requireConnected(row: ExecutorRow): void {
  if (row.status !== "connected") throw new ApplicationError("EXECUTOR_AUTH_REQUIRED", true);
}

async function requireCompanyOwner(
  db: BackendDatabase,
  companyId: string,
  memberId: string,
): Promise<void> {
  const rows = rowsFromResult<{ id: string }>(await db.execute(sql`
    select id from actors
    where company_id = ${companyId} and id = ${memberId}
      and type = 'human' and company_role = 'owner' and status = 'active'
      and system_role is null
    limit 2
  `));
  if (rows.length !== 1) throw new ApplicationError("FORBIDDEN", false);
}

function requiredName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 255) throw invalid();
  return name;
}
function requiredRow<T>(rows: T[]): T {
  if (rows.length !== 1) throw invalid();
  return rows[0]!;
}
function number(value: DatabaseNumber): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw invalid();
  return parsed;
}
function invalid(): ApplicationError {
  return new ApplicationError("EXECUTOR_NOT_FOUND", false);
}
function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}
