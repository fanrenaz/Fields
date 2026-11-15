import { randomUUID } from "node:crypto";
import type { CompanyFileActorSummary } from "@fields/contracts/public/company-file";

import { sql } from "drizzle-orm";

import type { Actor } from "../../../../domain/actor/index.js";
import type {
  EventDeadLetterTransaction,
  EventDeliveryFailure,
} from "../../../../application/eventing/index.js";
import {
  ACTOR_DIRECTORY_ACCESS_DENIED_CODE,
  ACTOR_DIRECTORY_CONFLICT_CODE,
  ACTOR_DIRECTORY_DATA_INVALID_CODE,
  ACTOR_DIRECTORY_UNAVAILABLE_CODE,
  type ActiveHumanDirectoryCaller,
  type ActiveOrdinaryActorProfile,
  type ActorDirectoryCommandRepository,
  type ActorDirectoryProfileQuery,
  type ActorDirectoryQueryRepository,
  type HumanActorEmailQuery,
} from "../../../../application/actor/ports/index.js";
import { ApplicationError } from "../../../../application/platform/errors.js";
import {
  PostgresEventDeadLetterTransaction,
} from "../../../eventing/postgres/repository.js";
import type { OwnerName, OwnerTransaction } from "../../../../application/platform/ports/index.js";
import type { BackendDatabase } from "../database-service.js";

type DatabaseExecutor = Pick<BackendDatabase, "execute">;
export type PostgresActorDirectoryTransactionResolver = (
  transaction: OwnerTransaction,
  expectedOwner: OwnerName,
) => DatabaseExecutor;
type ActorRow = {
  id: string;
  company_id: string;
  type: string;
  display_name: string;
  mark: string;
  company_role: string;
  status: string;
  auth_user_id: string | null;
};

export class PostgresCompanyFileActorSummaryQuery {
  constructor(private readonly db: BackendDatabase) {}

  async list(companyId: string, actorIds: readonly string[]): Promise<readonly CompanyFileActorSummary[]> {
    if (actorIds.length === 0) return Object.freeze([]);
    const rows = rowsFromResult<ActorRow>(await this.db.execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors
      where company_id = ${companyId}
        and system_role is null
        and id in ${sql`(${sql.join(actorIds.map((id) => sql`${id}`), sql`, `)})`}
      order by id asc
    `));
    return Object.freeze(rows.map((row) => ({
      actor_id: row.id,
      display_name: row.display_name,
      actor_type: row.type === "agent" ? "agent" as const : "human" as const,
    })));
  }
}

export class PostgresActorDirectoryRepository implements
  ActorDirectoryQueryRepository,
  ActorDirectoryProfileQuery,
  ActorDirectoryCommandRepository {
  constructor(
    private readonly db: BackendDatabase,
    private readonly resolveTransaction: PostgresActorDirectoryTransactionResolver,
  ) {}

  async requireActiveHumanCaller(input: {
    actorId: string;
    companyId: string;
  }): Promise<ActiveHumanDirectoryCaller> {
    const rows = rowsFromResult<ActorRow>(await this.db.execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors
      where id = ${input.actorId} and company_id = ${input.companyId}
        and type = 'human' and status = 'active' and system_role is null
      limit 2
    `));
    if (rows.length !== 1) throw new ApplicationError(ACTOR_DIRECTORY_ACCESS_DENIED_CODE, false);
    const actor = actorFromRow(rows[0]!);
    return { actorId: actor.id, companyId: actor.companyId, companyRole: actor.companyRole };
  }

  async listActiveActors(companyId: string): Promise<readonly Actor[]> {
    return Object.freeze(rowsFromResult<ActorRow>(await this.db.execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors where company_id = ${companyId} and status = 'active' and system_role is null
      order by company_role asc, display_name asc, id asc
    `)).map(actorFromRow));
  }

  async findActiveActor(input: {
    actorId: string;
    companyId: string;
  }): Promise<Actor | null> {
    try {
      return onlyActor(await this.db.execute(sql`
        select id, company_id, type, display_name, mark, company_role, status, auth_user_id
        from actors
        where id = ${input.actorId} and company_id = ${input.companyId}
          and status = 'active' and system_role is null
        limit 2
      `));
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ACTOR_DIRECTORY_UNAVAILABLE_CODE, true);
    }
  }

  async listActiveOrdinaryProfiles(input: {
    companyId: string;
    actorIds: readonly string[];
  }): Promise<readonly ActiveOrdinaryActorProfile[]> {
    if (input.actorIds.length === 0) return Object.freeze([]);
    const actors = rowsFromResult<ActorRow>(await this.db.execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors
      where company_id = ${input.companyId}
        and status = 'active'
        and system_role is null
        and id in ${sql`(${sql.join(input.actorIds.map((id) => sql`${id}`), sql`, `)})`}
      order by id asc
    `)).map(actorFromRow);
    return Object.freeze(actors.map((actor) => ({
      actorId: actor.id,
      companyId: actor.companyId,
      displayName: actor.displayName,
      mark: actor.mark,
      actorType: actor.type,
    })));
  }

  async createOrdinaryAgent(
    transaction: OwnerTransaction,
    actor: Actor,
    createdAtMs: number,
  ): Promise<Actor | null> {
    return onlyActor(await this.resolveTransaction(transaction, "actor").execute(sql`
      insert into actors (
        id, company_id, type, display_name, mark, company_role, status,
        auth_user_id, created_at_ms, updated_at_ms
      ) values (
        ${actor.id}, ${actor.companyId}, 'agent', ${actor.displayName}, ${actor.mark},
        'member', 'active', null, ${createdAtMs}, ${createdAtMs}
      )
      returning id, company_id, type, display_name, mark, company_role, status, auth_user_id
    `));
  }

  async findActorForRemoval(
    transaction: OwnerTransaction,
    input: { actorId: string; companyId: string },
  ): Promise<Actor | null> {
    return onlyActor(await this.resolveTransaction(transaction, "actor").execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors where id = ${input.actorId} and company_id = ${input.companyId}
        and system_role is null
      limit 2 for update
    `));
  }

  async deactivateOrdinaryAgent(
    transaction: OwnerTransaction,
    input: { actorId: string; companyId: string; updatedAtMs: number },
  ): Promise<Actor | null> {
    const database = this.resolveTransaction(transaction, "actor");
    const updated = onlyActor(await database.execute(sql`
      update actors set status = 'inactive', updated_at_ms = ${input.updatedAtMs}
      where id = ${input.actorId} and company_id = ${input.companyId}
        and type = 'agent' and company_role = 'member'
        and auth_user_id is null
        and status = 'active'
      returning id, company_id, type, display_name, mark, company_role, status, auth_user_id
    `));
    const transitioned = updated !== null;
    const actor = updated ?? onlyActor(await database.execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors
      where id = ${input.actorId} and company_id = ${input.companyId}
        and type = 'agent' and company_role = 'member'
        and auth_user_id is null and status = 'inactive'
      limit 2
    `));
    if (actor === null) return null;

    await database.execute(sql`
      update room_memberships
      set status = 'inactive', updated_at_ms = ${input.updatedAtMs}
      where company_id = ${input.companyId}
        and actor_id = ${input.actorId}
        and status = 'active'
    `);
    await database.execute(sql`
      update agent_room_states
      set membership_active = false, membership_version = membership_version + 1,
        updated_at_ms = ${input.updatedAtMs}
      where company_id = ${input.companyId}
        and agent_member_id = ${input.actorId}
        and membership_active = true
    `);
    await database.execute(sql`
      update agent_room_executions
      set status = 'cancelled', last_error_code = 'AGENT_REMOVED',
        last_error_retryable = false, completed_at_ms = ${input.updatedAtMs},
        updated_at_ms = ${input.updatedAtMs}
      where company_id = ${input.companyId}
        and agent_member_id = ${input.actorId}
        and status in ('pending', 'dispatched')
    `);
    await database.execute(sql`
      update agent_room_cascades cascade
      set status = 'silent_completed', completed_at_ms = ${input.updatedAtMs}
      where cascade.company_id = ${input.companyId}
        and cascade.status = 'active'
        and exists (
          select 1
          from agent_room_executions removed
          where removed.cascade_id = cascade.cascade_id
            and removed.agent_member_id = ${input.actorId}
            and removed.status = 'cancelled'
            and removed.last_error_code = 'AGENT_REMOVED'
        )
        and not exists (
          select 1
          from agent_room_executions active
          where active.cascade_id = cascade.cascade_id
            and active.status in ('pending', 'dispatched', 'running')
        )
    `);

    const pendingRows = rowsFromResult<{ operation_id: string }>(await database.execute(sql`
      select operation_id
      from agent_member_cleanup_operations
      where company_id = ${input.companyId}
        and member_id = ${input.actorId}
        and status = 'pending'
      order by created_at_ms desc, operation_id desc
      limit 2
    `));
    if (pendingRows.length > 1) {
      throw new ApplicationError(ACTOR_DIRECTORY_CONFLICT_CODE, true);
    }
    const succeededRows = rowsFromResult<{ operation_id: string }>(await database.execute(sql`
      select operation_id
      from agent_member_cleanup_operations
      where company_id = ${input.companyId}
        and member_id = ${input.actorId}
        and status = 'succeeded'
      limit 1
    `));
    if (!transitioned && pendingRows.length === 0 && succeededRows.length > 0) {
      return actor;
    }
    const operationId = pendingRows[0]?.operation_id ?? `cleanup_${randomUUID()}`;
    if (pendingRows.length === 0) {
      await database.execute(sql`
        insert into agent_member_cleanup_operations (
          operation_id, company_id, member_id, status, attempt,
          created_at_ms, updated_at_ms, completed_at_ms
        ) values (
          ${operationId}, ${input.companyId}, ${input.actorId},
          'pending', 0, ${input.updatedAtMs}, ${input.updatedAtMs}, null
        )
      `);
    }
    await database.execute(sql`
      insert into outbox_events (
        event_id, event_type, schema_version, aggregate_type, aggregate_id,
        payload_json, occurred_at_ms, dispatched_at_ms
      ) values (
        ${`agent-member-cleanup:${operationId}`},
        'execution.agent_member_cleanup_requested.v1', 1,
        'agent_member_cleanup', ${operationId},
        ${JSON.stringify({
          operation_id: operationId,
          company_id: input.companyId,
          member_id: input.actorId,
          requested_at_ms: input.updatedAtMs,
        })}::jsonb,
        ${input.updatedAtMs}, null
      )
      on conflict (event_id) do nothing
    `);
    return actor;
  }

  async readAgentMemberCleanup(operationId: string): Promise<{
    operationId: string;
    companyId: string;
    memberId: string;
    status: "pending" | "succeeded" | "failed";
    activeExecutionCount: number;
  } | null> {
    const rows = rowsFromResult<{
      operation_id: string;
      company_id: string;
      member_id: string;
      status: "pending" | "succeeded" | "failed";
      active_execution_count: number | string | bigint;
    }>(await this.db.execute(sql`
      select operation.operation_id, operation.company_id, operation.member_id,
        operation.status,
        (
          select count(*)
          from agent_room_executions execution
          where execution.company_id = operation.company_id
            and execution.agent_member_id = operation.member_id
            and execution.status in ('pending', 'dispatched', 'running')
        ) as active_execution_count
      from agent_member_cleanup_operations operation
      where operation.operation_id = ${operationId}
      limit 2
    `));
    if (rows.length > 1) throw new ApplicationError(ACTOR_DIRECTORY_CONFLICT_CODE, false);
    const row = rows[0];
    return row
      ? {
        operationId: row.operation_id,
        companyId: row.company_id,
        memberId: row.member_id,
        status: row.status,
        activeExecutionCount: Number(row.active_execution_count),
      }
      : null;
  }

  async finalizeAgentMemberCleanup(operationId: string, nowMs: number): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const operationRows = rowsFromResult<{
        company_id: string;
        member_id: string;
        status: string;
      }>(await transaction.execute(sql`
        select company_id, member_id, status
        from agent_member_cleanup_operations
        where operation_id = ${operationId}
        limit 2
        for update
      `));
      if (operationRows.length !== 1) {
        throw new ApplicationError(ACTOR_DIRECTORY_CONFLICT_CODE, false);
      }
      const operation = operationRows[0]!;
      if (operation.status === "succeeded") return;
      const activeRows = rowsFromResult<{ count: number | string | bigint }>(
        await transaction.execute(sql`
          select count(*) as count
          from agent_room_executions
          where company_id = ${operation.company_id}
            and agent_member_id = ${operation.member_id}
            and status in ('pending', 'dispatched', 'running')
        `),
      );
      if (Number(activeRows[0]?.count ?? 0) !== 0) {
        throw new ApplicationError("AGENT_MEMBER_CLEANUP_EXECUTION_ACTIVE", true);
      }
      await transaction.execute(sql`
        delete from agent_room_states
        where company_id = ${operation.company_id}
          and agent_member_id = ${operation.member_id}
      `);
      await transaction.execute(sql`
        delete from member_executor_assignments
        where company_id = ${operation.company_id}
          and member_id = ${operation.member_id}
      `);
      await transaction.execute(sql`
        update agent_member_cleanup_operations
        set status = 'succeeded',
          last_error_code = null, updated_at_ms = ${nowMs},
          completed_at_ms = ${nowMs}
        where operation_id = ${operationId}
      `);
    });
  }

  async recordAgentMemberCleanupAttempt(operationId: string, nowMs: number): Promise<void> {
    const rows = rowsFromResult<{ operation_id: string }>(await this.db.execute(sql`
      update agent_member_cleanup_operations
      set attempt = attempt + 1, updated_at_ms = ${nowMs}
      where operation_id = ${operationId}
        and status = 'pending'
      returning operation_id
    `));
    if (rows.length !== 1) {
      throw new ApplicationError(ACTOR_DIRECTORY_CONFLICT_CODE, false);
    }
  }

  async recordAgentMemberCleanupFailure(input: {
    operationId: string;
    errorCode: string;
    retryable: boolean;
    nowMs: number;
  }): Promise<void> {
    const safeCode = /^[A-Z][A-Z0-9_]{0,127}$/u.test(input.errorCode)
      ? input.errorCode
      : "AGENT_MEMBER_CLEANUP_FAILED";
    const rows = rowsFromResult<{ operation_id: string }>(await this.db.execute(sql`
      update agent_member_cleanup_operations
      set status = ${input.retryable ? "pending" : "failed"},
        last_error_code = ${safeCode}, updated_at_ms = ${input.nowMs},
        completed_at_ms = ${input.retryable ? null : input.nowMs}
      where operation_id = ${input.operationId}
        and status = 'pending'
      returning operation_id
    `));
    if (rows.length !== 1) {
      throw new ApplicationError(ACTOR_DIRECTORY_CONFLICT_CODE, false);
    }
  }

  async markAgentMemberCleanupDeadLetter(
    transaction: EventDeadLetterTransaction,
    input: {
      operationId: string;
      failure: EventDeliveryFailure;
      attemptedAtMs: number;
    },
  ): Promise<void> {
    if (!(transaction instanceof PostgresEventDeadLetterTransaction)) {
      throw new ApplicationError(ACTOR_DIRECTORY_CONFLICT_CODE, false);
    }
    const safeCode = /^[A-Z][A-Z0-9_]{0,127}$/u.test(input.failure.code)
      ? input.failure.code
      : "AGENT_MEMBER_CLEANUP_DEAD_LETTER";
    const rows = await transaction.execute<{ operation_id: string }>(sql`
      update agent_member_cleanup_operations
      set status = 'failed', last_error_code = ${safeCode},
        updated_at_ms = ${input.attemptedAtMs},
        completed_at_ms = ${input.attemptedAtMs}
      where operation_id = ${input.operationId}
        and status = 'pending'
      returning operation_id
    `);
    if (rows.length !== 1) {
      throw new ApplicationError(ACTOR_DIRECTORY_CONFLICT_CODE, false);
    }
  }
}

export class PostgresHumanActorEmailQuery implements HumanActorEmailQuery {
  constructor(private readonly db: BackendDatabase) {}

  async findEmailsByAuthUserIds(
    authUserIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (authUserIds.length === 0) return new Map();
    const rows = rowsFromResult<{ id: string; email: string }>(await this.db.execute(sql`
      select id, email from "user"
      where id in ${sql`(${sql.join(authUserIds.map((id) => sql`${id}`), sql`, `)})`}
    `));
    return new Map(rows.map((row) => [row.id, row.email]));
  }
}

function onlyActor(result: unknown): Actor | null {
  const rows = rowsFromResult<ActorRow>(result);
  if (rows.length > 1) throw new ApplicationError(ACTOR_DIRECTORY_CONFLICT_CODE, false);
  return rows[0] ? actorFromRow(rows[0]) : null;
}

function actorFromRow(row: ActorRow): Actor {
  if (
    !row.id
    || !row.company_id
    || !row.display_name.trim()
    || !row.mark.trim()
    || row.mark.length > 32
    || (row.type !== "human" && row.type !== "agent")
    || (row.company_role !== "owner" && row.company_role !== "member")
    || (row.status !== "active" && row.status !== "inactive")
    || (row.type === "human" && row.auth_user_id === null)
    || (row.type === "agent" && row.auth_user_id !== null)
  ) {
    throw new ApplicationError(ACTOR_DIRECTORY_DATA_INVALID_CODE, false);
  }
  return {
    id: row.id,
    companyId: row.company_id,
    type: row.type,
    displayName: row.display_name,
    mark: row.mark,
    companyRole: row.company_role,
    status: row.status,
    authUserId: row.auth_user_id,
  };
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}
