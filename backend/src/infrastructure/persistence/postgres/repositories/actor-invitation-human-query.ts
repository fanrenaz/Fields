import { sql } from "drizzle-orm";

import type {
  ActorInvitationHumanQuery,
  InvitationHumanActor,
} from "../../../../application/actor/ports/human-invitation-admission.js";
import type { BackendDatabase } from "../database-service.js";

type RetainedHumanRow = {
  actor_id: unknown;
};

type InvitationHumanRow = {
  auth_user_id: unknown;
  status: unknown;
};

/**
 * Actor-owned Human projection reads for invitation admission. Better Auth
 * identity and membership facts are deliberately resolved by a separate
 * Better Auth adapter before this query receives only selected Auth user ids.
 */
export class PostgresActorInvitationHumanQuery implements ActorInvitationHumanQuery {
  constructor(private readonly db: BackendDatabase) {}

  async hasRetainedHumanForAuthUser(authUserId: string): Promise<boolean> {
    try {
      if (!isAuthorityIdentifier(authUserId)) {
        throw unavailable();
      }
      const rows = rowsFromResult<RetainedHumanRow>(await this.db.execute(sql`
        select id as actor_id
        from actors
        where auth_user_id = ${authUserId}
          and type = 'human'
        limit 1
      `));
      if (rows.length === 0) {
        return false;
      }
      if (!isActorIdentifier(rows[0]?.actor_id)) {
        throw unavailable();
      }
      return true;
    } catch {
      throw unavailable();
    }
  }

  async listInvitationHumans(input: {
    companyId: string;
    authUserIds: readonly string[];
  }): Promise<readonly InvitationHumanActor[]> {
    try {
      if (!isCompanyIdentifier(input.companyId)) {
        throw unavailable();
      }
      const authUserIds = uniqueAuthorityIdentifiers(input.authUserIds);
      if (authUserIds.length === 0) {
        return [];
      }
      const values = sql.join(authUserIds.map((authUserId) => sql`${authUserId}`), sql`, `);
      const requestedAuthUserIds = new Set(authUserIds);
      const rows = rowsFromResult<InvitationHumanRow>(await this.db.execute(sql`
        select auth_user_id, status
        from actors
        where company_id = ${input.companyId}
          and type = 'human'
          and auth_user_id in (${values})
      `));
      const humans = rows.map((row) => invitationHumanFromRow(row, requestedAuthUserIds));
      assertUniqueHumanAuthorityIds(humans);
      return Object.freeze(humans);
    } catch {
      throw unavailable();
    }
  }
}

function invitationHumanFromRow(
  row: InvitationHumanRow,
  requestedAuthUserIds: ReadonlySet<string>,
): InvitationHumanActor {
  if (
    !isAuthorityIdentifier(row.auth_user_id)
    || !requestedAuthUserIds.has(row.auth_user_id)
    || !isInvitationHumanStatus(row.status)
  ) {
    throw unavailable();
  }
  return {
    authUserId: row.auth_user_id,
    status: row.status,
  };
}

function uniqueAuthorityIdentifiers(value: readonly string[]): string[] {
  if (!Array.isArray(value) || !value.every(isAuthorityIdentifier)) {
    throw unavailable();
  }
  return [...new Set(value)];
}

function assertUniqueHumanAuthorityIds(humans: readonly InvitationHumanActor[]): void {
  const ids = new Set<string>();
  for (const human of humans) {
    if (ids.has(human.authUserId)) {
      throw unavailable();
    }
    ids.add(human.authUserId);
  }
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as T[];
    }
  }
  throw unavailable();
}

function isAuthorityIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && value.trim() === value
    && !/[\r\n]/u.test(value);
}

function isCompanyIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && value.trim() === value
    && !/[\r\n]/u.test(value);
}

function isActorIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && value.trim() === value
    && !/[\r\n]/u.test(value);
}

function isInvitationHumanStatus(value: unknown): value is "active" | "inactive" {
  return value === "active" || value === "inactive";
}

function unavailable(): Error {
  return new Error("Invitation Human projection is temporarily unavailable.");
}
