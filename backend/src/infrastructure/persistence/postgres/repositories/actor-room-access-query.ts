import { sql } from "drizzle-orm";

import { ApplicationError, isApplicationError } from "../../../../application/platform/errors.js";
import {
  ROOM_ACTOR_ACCESS_DENIED_CODE,
  ROOM_ACTOR_ACCESS_UNAVAILABLE_CODE,
  type ActiveOrdinaryRoomActor,
  type RoomActorAccessQuery,
} from "../../../../application/room/ports/index.js";
import type { BackendDatabase } from "../database-service.js";

type RoomActorAccessRow = {
  id: unknown;
  company_id: unknown;
  type: unknown;
  status: unknown;
};

/**
 * Actor-owned authorization projection for Room commands. It intentionally
 * reads no Room data.
 */
export class PostgresRoomActorAccessQuery implements RoomActorAccessQuery {
  constructor(private readonly db: BackendDatabase) {}

  async requireActiveOrdinaryActor(input: {
    actorId: string;
    companyId: string;
  }): Promise<ActiveOrdinaryRoomActor> {
    try {
      const rows = rowsFromResult<RoomActorAccessRow>(await this.db.execute(sql`
        select id, company_id, type, status
        from actors
        where id = ${input.actorId}
          and company_id = ${input.companyId}
          and status = 'active'
          and system_role is null
          and type in ('human', 'agent')
        limit 2
      `));
      const row = rows.length === 1 ? rows[0] : null;
      if (!isActiveOrdinaryRoomActor(row, input)) {
        throw new ApplicationError(ROOM_ACTOR_ACCESS_DENIED_CODE, false);
      }
      return {
        actorId: row.id,
        companyId: row.company_id,
        actorType: row.type,
      };
    } catch (error) {
      if (isApplicationError(error)) {
        throw error;
      }
      throw new ApplicationError(ROOM_ACTOR_ACCESS_UNAVAILABLE_CODE, true);
    }
  }
}

function isActiveOrdinaryRoomActor(
  row: RoomActorAccessRow | null,
  input: { actorId: string; companyId: string },
): row is RoomActorAccessRow & { id: string; company_id: string; type: "human" | "agent" } {
  return row !== null
    && typeof row.id === "string"
    && row.id === input.actorId
    && typeof row.company_id === "string"
    && row.company_id === input.companyId
    && (row.type === "human" || row.type === "agent")
    && row.status === "active";
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
