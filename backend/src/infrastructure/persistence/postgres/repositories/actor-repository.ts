import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Actor } from "../../../../domain/actor/index.js";
import type {
  ActorAccessQuery,
  ActorCommandRepository,
  ActorQueryRepository,
} from "../../../../application/actor/ports/index.js";
import { ApplicationError } from "../../../../application/platform/errors.js";
import type { OwnerName, OwnerTransaction } from "../../../../application/platform/ports/index.js";
import type { BackendDatabase } from "../database-service.js";

export const ACTOR_PERSISTENCE_CONFLICT_CODE = "ACTOR_PERSISTENCE_CONFLICT";
export const ACTOR_PERSISTENCE_UNAVAILABLE_CODE = "ACTOR_PERSISTENCE_UNAVAILABLE";

type DatabaseExecutor = Pick<BackendDatabase, "execute">;
export type PostgresActorTransactionResolver = (
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

export class PostgresActorRepository implements
  ActorCommandRepository,
  ActorQueryRepository,
  ActorAccessQuery {
  constructor(
    private readonly db: BackendDatabase,
    private readonly resolveTransaction: PostgresActorTransactionResolver,
  ) {}

  async findHumanForReconciliation(
    transaction: OwnerTransaction,
    authUserId: string,
  ): Promise<Actor | null> {
    return this.only(await this.resolveTransaction(transaction, "actor").execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors where auth_user_id = ${authUserId} limit 2 for update
    `));
  }

  async create(transaction: OwnerTransaction, actor: Actor): Promise<void> {
    try {
      await this.resolveTransaction(transaction, "actor").execute(sql`
        insert into actors (
          id, company_id, type, display_name, mark, company_role, status,
          auth_user_id, system_role, created_at_ms, updated_at_ms
        ) values (
          ${actor.id}, ${actor.companyId}, ${actor.type}, ${actor.displayName},
          ${actor.mark}, ${actor.companyRole}, ${actor.status}, ${actor.authUserId},
          ${actor.systemRole ?? null},
          0, 0
        )
      `);
    } catch (error) {
      throw actorPersistenceError(error);
    }
  }

  async updateHumanProjection(
    transaction: OwnerTransaction,
    input: {
      actorId: string;
      authUserId: string;
      companyId: string;
      displayName: string;
      mark: string;
      companyRole: "owner" | "member";
      status: "active" | "inactive";
      updatedAtMs: number;
    },
  ): Promise<Actor | null> {
    return this.only(await this.resolveTransaction(transaction, "actor").execute(sql`
      update actors
      set display_name = ${input.displayName}, mark = ${input.mark},
        company_role = ${input.companyRole}, status = ${input.status},
        updated_at_ms = ${input.updatedAtMs}
      where id = ${input.actorId}
        and company_id = ${input.companyId}
        and type = 'human'
        and auth_user_id = ${input.authUserId}
      returning id, company_id, type, display_name, mark, company_role, status, auth_user_id
    `));
  }

  async inactivate(
    transaction: OwnerTransaction,
    actorId: string,
    updatedAtMs: number,
  ): Promise<Actor | null> {
    const database = this.resolveTransaction(transaction, "actor");
    const current = await this.only(await database.execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors where id = ${actorId} and system_role is null limit 2 for update
    `));
    if (!current) return null;
    const transitioned = current.status === "active";
    const actor = transitioned
      ? await this.only(await database.execute(sql`
        update actors set status = 'inactive', updated_at_ms = ${updatedAtMs}
        where id = ${actorId} and status = 'active' and system_role is null
        returning id, company_id, type, display_name, mark, company_role, status, auth_user_id
      `))
      : current;
    if (!actor) return null;
    const pendingRows = rowsFromResult<{ operation_id: string }>(await database.execute(sql`
      select operation_id
      from agent_member_cleanup_operations
      where company_id = ${actor.companyId}
        and member_id = ${actor.id}
        and status = 'pending'
      order by created_at_ms desc, operation_id desc
      limit 2
    `));
    if (pendingRows.length > 1) {
      throw new ApplicationError(ACTOR_PERSISTENCE_CONFLICT_CODE, true);
    }
    const succeededRows = rowsFromResult<{ operation_id: string }>(await database.execute(sql`
      select operation_id
      from agent_member_cleanup_operations
      where company_id = ${actor.companyId}
        and member_id = ${actor.id}
        and status = 'succeeded'
      limit 1
    `));
    if (!transitioned && pendingRows.length === 0 && succeededRows.length > 0) {
      return actor;
    }
    const existingPendingId = pendingRows[0]?.operation_id;
    const operationId = existingPendingId ?? `cleanup_${randomUUID()}`;
    if (!existingPendingId) {
      await database.execute(sql`
        insert into agent_member_cleanup_operations (
          operation_id, company_id, member_id, status, attempt,
          created_at_ms, updated_at_ms, completed_at_ms
        ) values (
          ${operationId}, ${actor.companyId}, ${actor.id},
          'pending', 0, ${updatedAtMs}, ${updatedAtMs}, null
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
          company_id: actor.companyId,
          member_id: actor.id,
          requested_at_ms: updatedAtMs,
        })}::jsonb,
        ${updatedAtMs}, null
      )
      on conflict (event_id) do nothing
    `);
    return actor;
  }

  async removeOrdinaryAgent(
    transaction: OwnerTransaction,
    actorId: string,
    updatedAtMs: number,
  ): Promise<Actor | null> {
    return this.only(await this.resolveTransaction(transaction, "actor").execute(sql`
      update actors set status = 'inactive', updated_at_ms = ${updatedAtMs}
      where id = ${actorId} and type = 'agent' and system_role is null
      returning id, company_id, type, display_name, mark, company_role, status, auth_user_id
    `));
  }

  async findById(actorId: string): Promise<Actor | null> {
    return this.only(await this.db.execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors where id = ${actorId} and system_role is null limit 2
    `));
  }

  async findByAuthUserId(userId: string): Promise<Actor | null> {
    return this.only(await this.db.execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors where auth_user_id = ${userId} limit 2
    `));
  }

  async listByCompanyId(companyId: string): Promise<readonly Actor[]> {
    return Object.freeze(rowsFromResult<ActorRow>(await this.db.execute(sql`
      select id, company_id, type, display_name, mark, company_role, status, auth_user_id
      from actors where company_id = ${companyId} and system_role is null order by id asc
    `)).map(actorFromRow));
  }

  async requireActiveActor(input: {
    actorId: string;
    companyId: string;
  }): Promise<{ actorId: string; companyId: string; companyRole: "owner" | "member" }> {
    const actor = await this.findById(input.actorId);
    if (!actor || actor.companyId !== input.companyId || actor.status !== "active") {
      throw new ApplicationError(ACTOR_PERSISTENCE_CONFLICT_CODE, false);
    }
    return { actorId: actor.id, companyId: actor.companyId, companyRole: actor.companyRole };
  }

  private async only(result: unknown): Promise<Actor | null> {
    try {
      const rows = rowsFromResult<ActorRow>(result);
      if (rows.length > 1) throw new ApplicationError(ACTOR_PERSISTENCE_CONFLICT_CODE, false);
      return rows[0] ? actorFromRow(rows[0]) : null;
    } catch (error) {
      throw actorPersistenceError(error);
    }
  }
}

function actorFromRow(row: ActorRow): Actor {
  if (
    (row.type !== "human" && row.type !== "agent")
    || (row.company_role !== "owner" && row.company_role !== "member")
    || (row.status !== "active" && row.status !== "inactive")
  ) {
    throw new ApplicationError(ACTOR_PERSISTENCE_UNAVAILABLE_CODE, true);
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
    return Array.isArray(rows) ? rows as T[] : [];
  }
  return [];
}

function actorPersistenceError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  return new ApplicationError(ACTOR_PERSISTENCE_UNAVAILABLE_CODE, true);
}
