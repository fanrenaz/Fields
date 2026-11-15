import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Room, RoomMembership, RoomStatus } from "../../../../domain/room/index.js";
import type {
  NewRoomMembership,
  RoomAccess,
  RoomAccessQuery,
  RoomCommandRepository,
  RoomListProjectionQuery,
  RoomListSummary,
  RoomMembershipMutationState,
  RoomMembershipProjection,
  RoomMembershipQuery,
  RoomQueryRepository,
} from "../../../../application/room/ports/index.js";
import { ApplicationError } from "../../../../application/platform/errors.js";
import type { OwnerName, OwnerTransaction } from "../../../../application/platform/ports/index.js";
import type { BackendDatabase } from "../database-service.js";

export const ROOM_PERSISTENCE_CONFLICT_CODE = "ROOM_PERSISTENCE_CONFLICT";
export const ROOM_PERSISTENCE_UNAVAILABLE_CODE = "ROOM_PERSISTENCE_UNAVAILABLE";
export const ROOM_ACCESS_DENIED_CODE = "ROOM_ACCESS_DENIED";
export const ROOM_OWNER_ACCESS_DENIED_CODE = "ROOM_OWNER_ACCESS_DENIED";

type DatabaseExecutor = Pick<BackendDatabase, "execute">;

/**
 * Composition supplies postgresTransactionForOwner from the shared Owner UoW
 * bridge. The adapter never exposes that database transaction to Application.
 */
export type PostgresRoomTransactionResolver = (
  transaction: OwnerTransaction,
  expectedOwner: OwnerName,
) => DatabaseExecutor;

type DatabaseNumber = number | string | bigint;

type RoomRow = {
  id: string;
  company_id: string;
  name: string;
  subtitle: string | null;
  status: string;
  created_by_actor_id: string;
  membership_version: DatabaseNumber;
  created_at_ms: DatabaseNumber;
  updated_at_ms: DatabaseNumber;
  unread_count: DatabaseNumber;
  archived_at_ms: DatabaseNumber | null;
};

type RoomMembershipRow = {
  id: string;
  room_id: string;
  company_id: string;
  actor_id: string;
  role: string;
  status: string;
  joined_at_ms: DatabaseNumber;
  created_at_ms: DatabaseNumber;
  updated_at_ms: DatabaseNumber;
};

type RoomListSummaryRow = {
  room_id: string;
  name: string;
  subtitle: string | null;
  status: string;
  updated_at_ms: DatabaseNumber;
  unread_count: DatabaseNumber;
  latest_notification_sequence: DatabaseNumber | null;
};

type RoomMembershipProjectionRow = {
  room_id: string;
  room_company_id: string;
  room_name: string;
  room_subtitle: string | null;
  room_status: string;
  room_created_by_actor_id: string;
  room_membership_version: DatabaseNumber;
  room_created_at_ms: DatabaseNumber;
  room_updated_at_ms: DatabaseNumber;
  room_archived_at_ms: DatabaseNumber | null;
  membership_id: string | null;
  membership_room_id: string | null;
  membership_company_id: string | null;
  membership_actor_id: string | null;
  membership_role: string | null;
  membership_status: string | null;
  membership_joined_at_ms: DatabaseNumber | null;
  membership_created_at_ms: DatabaseNumber | null;
  membership_updated_at_ms: DatabaseNumber | null;
};

/**
 * PostgreSQL implementation for Room-owned persistence and read projections.
 * It reads and joins only rooms and room_memberships; Actor ownership remains
 * behind the RoomActorAccessQuery injected by Composition.
 */
export class PostgresRoomRepository implements
  RoomCommandRepository,
  RoomQueryRepository,
  RoomListProjectionQuery,
  RoomAccessQuery,
  RoomMembershipQuery {
  constructor(
    private readonly db: BackendDatabase,
    private readonly resolveTransaction: PostgresRoomTransactionResolver,
  ) {}

  async create(transaction: OwnerTransaction, room: Room, ownerMembership: NewRoomMembership): Promise<void> {
    try {
      assertInitialOwner(room, ownerMembership);
      const databaseTransaction = this.resolveTransaction(transaction, "room");
      await databaseTransaction.execute(sql`
        insert into rooms (
          id, company_id, name, subtitle, status, created_by_actor_id,
          membership_version, created_at_ms, updated_at_ms, archived_at_ms
        ) values (
          ${room.id}, ${room.companyId}, ${room.name}, ${room.subtitle}, ${room.status},
          ${room.createdByActorId}, ${room.membershipVersion}, ${room.createdAtMs},
          ${room.updatedAtMs}, ${room.archivedAtMs}
        )
      `);
      const schedulerMembership = rowsFromResult<{ id: string }>(await databaseTransaction.execute(sql`
        insert into room_memberships (
          id, room_id, company_id, actor_id, role, status,
          joined_at_ms, created_at_ms, updated_at_ms
        )
        select ${newRoomMembershipId()}, ${ownerMembership.roomId}, ${ownerMembership.companyId},
          scheduler.id, 'member', 'active', ${ownerMembership.joinedAtMs},
          ${ownerMembership.createdAtMs}, ${ownerMembership.updatedAtMs}
        from actors scheduler
        where scheduler.company_id = ${ownerMembership.companyId}
          and scheduler.system_role = 'scheduler'
          and scheduler.status = 'active'
        returning id
      `));
      if (schedulerMembership.length !== 1) {
        throw new ApplicationError(ROOM_PERSISTENCE_CONFLICT_CODE, true);
      }
      await databaseTransaction.execute(sql`
        insert into room_memberships (
          id, room_id, company_id, actor_id, role, status,
          joined_at_ms, created_at_ms, updated_at_ms
        ) values (
          ${newRoomMembershipId()}, ${ownerMembership.roomId}, ${ownerMembership.companyId},
          ${ownerMembership.actorId}, ${ownerMembership.role}, ${ownerMembership.status},
          ${ownerMembership.joinedAtMs}, ${ownerMembership.createdAtMs}, ${ownerMembership.updatedAtMs}
        )
      `);
    } catch (error) {
      throw roomPersistenceError(error);
    }
  }

  /** Locks the Room first, then its target membership, on the exact Room UoW transaction. */
  async readMembershipForMutation(
    transaction: OwnerTransaction,
    input: { roomId: string; actorId: string },
  ): Promise<RoomMembershipMutationState | null> {
    try {
      const databaseTransaction = this.resolveTransaction(transaction, "room");
      const room = onlyRoom(rowsFromResult<RoomRow>(await databaseTransaction.execute(sql`
        select id, company_id, name, subtitle, status, created_by_actor_id,
          membership_version, created_at_ms, updated_at_ms, archived_at_ms
        from rooms where id = ${input.roomId} and status = 'active' limit 2 for update
      `)));
      if (room === null) {
        return null;
      }
      const membership = onlyRoomMembership(rowsFromResult<RoomMembershipRow>(await databaseTransaction.execute(sql`
        select id, room_id, company_id, actor_id, role, status,
          joined_at_ms, created_at_ms, updated_at_ms
        from room_memberships
        where room_id = ${input.roomId}
          and company_id = ${room.companyId}
          and actor_id = ${input.actorId}
        limit 2 for update
      `)));
      return { room, membership };
    } catch (error) {
      throw roomPersistenceError(error);
    }
  }

  /**
   * Applies exactly one already-decided mutation. The Room version predicate
   * fences accidental stale writes; callers use the prior locked state to
   * calculate this next version.
   */
  async applyMembershipChange(
    transaction: OwnerTransaction,
    input: {
      roomId: string;
      actorId: string;
      change: "added" | "reactivated" | "removed" | "unchanged";
      membershipVersion: number;
      joinedAtMs: number;
      updatedAtMs: number;
      actorType: "human" | "agent";
    },
  ): Promise<RoomMembership | null> {
    try {
      assertMutationInput(input);
      const databaseTransaction = this.resolveTransaction(transaction, "room");
      if (input.change === "unchanged") {
        return this.readMembershipForUnchangedMutation(databaseTransaction, input);
      }

      const membership = await this.writeMembershipMutation(databaseTransaction, {
        ...input,
        change: mutationChange(input.change),
      });
      if (membership === null) {
        return null;
      }
      if (input.actorType === "agent") {
        await this.synchronizeAgentRoomState(databaseTransaction, input);
      }

      const expectedPreviousVersion = input.membershipVersion - 1;
      const updatedRooms = rowsFromResult<{ id: string }>(await databaseTransaction.execute(sql`
        update rooms
        set membership_version = ${input.membershipVersion}, updated_at_ms = ${input.updatedAtMs}
        where id = ${input.roomId}
          and status = 'active'
          and membership_version = ${expectedPreviousVersion}
        returning id
      `));
      if (updatedRooms.length !== 1) {
        throw new ApplicationError(ROOM_PERSISTENCE_CONFLICT_CODE, false);
      }
      return membership;
    } catch (error) {
      throw roomPersistenceError(error);
    }
  }

  async findById(roomId: string): Promise<Room | null> {
    try {
      return onlyRoom(rowsFromResult<RoomRow>(await this.db.execute(sql`
        select id, company_id, name, subtitle, status, created_by_actor_id,
          membership_version, created_at_ms, updated_at_ms, archived_at_ms
        from rooms where id = ${roomId} limit 2
      `)));
    } catch (error) {
      throw roomPersistenceError(error);
    }
  }

  async listByCompanyId(companyId: string): Promise<readonly Room[]> {
    try {
      return rowsFromResult<RoomRow>(await this.db.execute(sql`
        select id, company_id, name, subtitle, status, created_by_actor_id,
          membership_version, created_at_ms, updated_at_ms, archived_at_ms
        from rooms where company_id = ${companyId}
        order by created_at_ms asc, id asc
      `)).map(roomFromRow);
    } catch (error) {
      throw roomPersistenceError(error);
    }
  }

  /**
   * Room-owned access-filtered summary page. It intentionally joins only the
   * Room membership fact that grants visibility; Actor profile hydration is a
   * separate public Actor query composed above this adapter.
   */
  async listVisibleRoomSummaries(input: {
    companyId: string;
    actorId: string;
    cursor: { updatedAtMs: number; roomId: string } | null;
    limit: number;
    includeArchived: boolean;
    searchTerm?: string;
  }): Promise<readonly RoomListSummary[]> {
    try {
      const cursor = input.cursor;
      const archivedClause = input.includeArchived ? sql.empty() : sql`and room.status = 'active'`;
      const cursorClause = cursor === null
        ? sql.empty()
        : sql`and (
          room.updated_at_ms < ${cursor.updatedAtMs}
          or (room.updated_at_ms = ${cursor.updatedAtMs} and room.id > ${cursor.roomId})
        )`;
      const searchClause = input.searchTerm ? sql`and (room.name ilike ${`%${escapeLike(input.searchTerm)}%`} escape '\\' or coalesce(room.subtitle, '') ilike ${`%${escapeLike(input.searchTerm)}%`} escape '\\')` : sql.empty();
      return rowsFromResult<RoomListSummaryRow>(await this.db.execute(sql`
        select room.id as room_id, room.name, room.subtitle, room.status, room.updated_at_ms,
          (select count(*) from notification_activities activity
           left join notification_read_cursors cursor on cursor.company_id = activity.company_id and cursor.recipient_actor_id = activity.recipient_actor_id and cursor.target_kind = activity.target_kind and cursor.target_id = activity.target_id
           where activity.company_id = room.company_id and activity.recipient_actor_id = ${input.actorId}
             and activity.target_kind = 'room' and activity.target_id = room.id and activity.sequence > coalesce(cursor.through_sequence, 0)) as unread_count,
          (select max(activity.sequence) from notification_activities activity
           where activity.company_id = room.company_id and activity.recipient_actor_id = ${input.actorId}
             and activity.target_kind = 'room' and activity.target_id = room.id) as latest_notification_sequence
        from rooms room
        inner join room_memberships membership
          on membership.room_id = room.id
          and membership.company_id = room.company_id
        where room.company_id = ${input.companyId}
          and membership.actor_id = ${input.actorId}
          and membership.company_id = ${input.companyId}
          and membership.status = 'active'
          ${archivedClause}
          ${cursorClause}
          ${searchClause}
        order by room.updated_at_ms desc, room.id asc
        limit ${input.limit + 1}
      `)).map(roomListSummaryFromRow);
    } catch (error) {
      throw roomPersistenceError(error);
    }
  }

  async listActiveMembers(roomId: string): Promise<readonly RoomMembership[]> {
    try {
      return rowsFromResult<RoomMembershipRow>(await this.db.execute(sql`
        select membership.id, membership.room_id, membership.company_id,
          membership.actor_id, membership.role, membership.status,
          membership.joined_at_ms, membership.created_at_ms, membership.updated_at_ms
        from room_memberships membership
        join rooms room on room.id = membership.room_id and room.company_id = membership.company_id
        where room.id = ${roomId} and membership.status = 'active'
        order by membership.joined_at_ms asc, membership.actor_id asc
      `)).map(roomMembershipFromRow);
    } catch (error) {
      throw roomPersistenceError(error);
    }
  }

  async currentMembershipVersion(roomId: string): Promise<number | null> {
    try {
      const rows = rowsFromResult<{ membership_version: DatabaseNumber }>(await this.db.execute(sql`
        select membership_version from rooms where id = ${roomId} limit 2
      `));
      if (rows.length > 1) {
        throw new ApplicationError(ROOM_PERSISTENCE_CONFLICT_CODE, false);
      }
      return rows[0] ? nonNegativeNumberFromDb(rows[0].membership_version) : null;
    } catch (error) {
      throw roomPersistenceError(error);
    }
  }

  async requireMember(input: { roomId: string; actorId: string }): Promise<RoomAccess> {
    return this.requireAccess(input, false);
  }

  async requireOwner(input: { roomId: string; actorId: string }): Promise<RoomAccess & { role: "owner" }> {
    const access = await this.requireAccess(input, true);
    return { ...access, role: "owner" };
  }

  async readCurrentMembership(roomId: string): Promise<RoomMembershipProjection | null> {
    try {
      const rows = rowsFromResult<RoomMembershipProjectionRow>(await this.db.execute(sql`
        select
          room.id as room_id,
          room.company_id as room_company_id,
          room.name as room_name,
          room.subtitle as room_subtitle,
          room.status as room_status,
          room.created_by_actor_id as room_created_by_actor_id,
          room.membership_version as room_membership_version,
          room.created_at_ms as room_created_at_ms,
          room.updated_at_ms as room_updated_at_ms,
          room.archived_at_ms as room_archived_at_ms,
          membership.id as membership_id,
          membership.room_id as membership_room_id,
          membership.company_id as membership_company_id,
          membership.actor_id as membership_actor_id,
          membership.role as membership_role,
          membership.status as membership_status,
          membership.joined_at_ms as membership_joined_at_ms,
          membership.created_at_ms as membership_created_at_ms,
          membership.updated_at_ms as membership_updated_at_ms
        from rooms room
        left join room_memberships membership
          on membership.room_id = room.id
          and membership.company_id = room.company_id
          and membership.status = 'active'
        where room.id = ${roomId}
        order by membership.joined_at_ms asc nulls last, membership.actor_id asc nulls last
      `));
      const first = rows[0];
      if (!first) {
        return null;
      }
      const room = roomFromProjectionRow(first);
      return {
        roomId: room.id,
        companyId: room.companyId,
        membershipVersion: room.membershipVersion,
        members: rows.flatMap((row) => roomMembershipFromProjectionRow(row)),
      };
    } catch (error) {
      throw roomPersistenceError(error);
    }
  }

  private async writeMembershipMutation(
    databaseTransaction: DatabaseExecutor,
    input: {
      roomId: string;
      actorId: string;
      change: "added" | "reactivated" | "removed";
      membershipVersion: number;
      joinedAtMs: number;
      updatedAtMs: number;
      actorType: "human" | "agent";
    },
  ): Promise<RoomMembership | null> {
    if (input.change === "added") {
      return onlyRoomMembership(rowsFromResult<RoomMembershipRow>(await databaseTransaction.execute(sql`
        insert into room_memberships (
          id, room_id, company_id, actor_id, role, status,
          joined_at_ms, created_at_ms, updated_at_ms
        )
        select ${newRoomMembershipId()}, room.id, room.company_id, ${input.actorId},
          'member', 'active', ${input.joinedAtMs}, ${input.updatedAtMs}, ${input.updatedAtMs}
        from rooms room
        where room.id = ${input.roomId} and room.status = 'active'
        on conflict (room_id, actor_id) do nothing
        returning id, room_id, company_id, actor_id, role, status,
          joined_at_ms, created_at_ms, updated_at_ms
      `)));
    }

    if (input.change === "reactivated") {
      return onlyRoomMembership(rowsFromResult<RoomMembershipRow>(await databaseTransaction.execute(sql`
        update room_memberships membership
        set role = 'member', status = 'active', joined_at_ms = ${input.joinedAtMs},
          updated_at_ms = ${input.updatedAtMs}
        from rooms room
        where membership.room_id = room.id
          and membership.company_id = room.company_id
          and room.id = ${input.roomId}
          and room.status = 'active'
          and membership.actor_id = ${input.actorId}
          and membership.status = 'inactive'
        returning membership.id, membership.room_id, membership.company_id,
          membership.actor_id, membership.role, membership.status,
          membership.joined_at_ms, membership.created_at_ms, membership.updated_at_ms
      `)));
    }

    return onlyRoomMembership(rowsFromResult<RoomMembershipRow>(await databaseTransaction.execute(sql`
      update room_memberships membership
      set status = 'inactive', updated_at_ms = ${input.updatedAtMs}
      from rooms room
      where membership.room_id = room.id
        and membership.company_id = room.company_id
        and room.id = ${input.roomId}
        and room.status = 'active'
        and membership.actor_id = ${input.actorId}
        and membership.status = 'active'
        and membership.role = 'member'
      returning membership.id, membership.room_id, membership.company_id,
        membership.actor_id, membership.role, membership.status,
        membership.joined_at_ms, membership.created_at_ms, membership.updated_at_ms
    `)));
  }

  private async synchronizeAgentRoomState(
    databaseTransaction: DatabaseExecutor,
    input: {
      roomId: string;
      actorId: string;
      change: "added" | "reactivated" | "removed" | "unchanged";
      membershipVersion: number;
      updatedAtMs: number;
    },
  ): Promise<void> {
    if (input.change === "added" || input.change === "reactivated") {
      const rows = rowsFromResult<{ room_id: string }>(await databaseTransaction.execute(sql`
        insert into agent_room_states (
          room_id, company_id, agent_member_id, trigger_policy,
          trigger_policy_version, thread_id, cursor_sequence,
          eligible_from_sequence, membership_active, membership_version,
          created_at_ms, updated_at_ms
        )
        select room.id, room.company_id, ${input.actorId}, 'human_explicit',
          1, null, 0, room.next_message_sequence, true,
          ${input.membershipVersion}, ${input.updatedAtMs}, ${input.updatedAtMs}
        from rooms room
        where room.id = ${input.roomId}
          and room.status = 'active'
        on conflict (room_id, agent_member_id) do update
        set eligible_from_sequence = excluded.eligible_from_sequence,
          membership_active = true,
          membership_version = excluded.membership_version,
          updated_at_ms = excluded.updated_at_ms
        returning room_id
      `));
      if (rows.length !== 1) throw new ApplicationError(ROOM_PERSISTENCE_CONFLICT_CODE, true);
      return;
    }
    if (input.change === "removed") {
      const rows = rowsFromResult<{ room_id: string }>(await databaseTransaction.execute(sql`
        update agent_room_states
        set membership_active = false,
          membership_version = ${input.membershipVersion},
          updated_at_ms = ${input.updatedAtMs}
        where room_id = ${input.roomId}
          and agent_member_id = ${input.actorId}
          and membership_active = true
        returning room_id
      `));
      if (rows.length !== 1) throw new ApplicationError(ROOM_PERSISTENCE_CONFLICT_CODE, true);
    }
  }

  private async readMembershipForUnchangedMutation(
    databaseTransaction: DatabaseExecutor,
    input: { roomId: string; actorId: string },
  ): Promise<RoomMembership | null> {
    return onlyRoomMembership(rowsFromResult<RoomMembershipRow>(await databaseTransaction.execute(sql`
      select membership.id, membership.room_id, membership.company_id,
        membership.actor_id, membership.role, membership.status,
        membership.joined_at_ms, membership.created_at_ms, membership.updated_at_ms
      from room_memberships membership
      join rooms room on room.id = membership.room_id and room.company_id = membership.company_id
      where room.id = ${input.roomId}
        and room.status = 'active'
        and membership.actor_id = ${input.actorId}
      limit 2
    `)));
  }

  private async requireAccess(
    input: { roomId: string; actorId: string },
    ownerRequired: boolean,
  ): Promise<RoomAccess> {
    try {
      const roleClause = ownerRequired ? sql`and membership.role = 'owner'` : sql.empty();
      const rows = rowsFromResult<{
        room_id: string;
        company_id: string;
        actor_id: string;
        role: string;
      }>(await this.db.execute(sql`
        select room.id as room_id, room.company_id, membership.actor_id, membership.role
        from rooms room
        join room_memberships membership
          on membership.room_id = room.id and membership.company_id = room.company_id
        where room.id = ${input.roomId}
          and room.status = 'active'
          and membership.actor_id = ${input.actorId}
          and membership.status = 'active'
          ${roleClause}
        limit 2
      `));
      if (rows.length !== 1) {
        throw new ApplicationError(
          ownerRequired ? ROOM_OWNER_ACCESS_DENIED_CODE : ROOM_ACCESS_DENIED_CODE,
          false,
        );
      }
      const row = rows[0];
      return {
        roomId: row.room_id,
        companyId: row.company_id,
        actorId: row.actor_id,
        role: roomMembershipRoleFromDb(row.role),
      };
    } catch (error) {
      throw roomPersistenceError(error);
    }
  }
}

function assertInitialOwner(room: Room, ownerMembership: NewRoomMembership): void {
  if (
    room.membershipVersion !== 1
    || ownerMembership.roomId !== room.id
    || ownerMembership.companyId !== room.companyId
    || ownerMembership.actorId !== room.createdByActorId
    || ownerMembership.role !== "owner"
    || ownerMembership.status !== "active"
  ) {
    throw new ApplicationError(ROOM_PERSISTENCE_CONFLICT_CODE, false);
  }
}

function assertMutationInput(input: {
  change: "added" | "reactivated" | "removed" | "unchanged";
  membershipVersion: number;
  joinedAtMs: number;
  updatedAtMs: number;
}): void {
  if (
    !Number.isSafeInteger(input.membershipVersion)
    || input.membershipVersion < 1
    || !Number.isSafeInteger(input.joinedAtMs)
    || input.joinedAtMs < 0
    || !Number.isSafeInteger(input.updatedAtMs)
    || input.updatedAtMs < 0
  ) {
    throw new ApplicationError(ROOM_PERSISTENCE_CONFLICT_CODE, false);
  }
}

function mutationChange(change: "added" | "reactivated" | "removed" | "unchanged"):
  "added" | "reactivated" | "removed" {
  if (change === "unchanged") {
    throw new ApplicationError(ROOM_PERSISTENCE_CONFLICT_CODE, false);
  }
  return change;
}

function newRoomMembershipId(): string {
  return `room_membership_${randomUUID()}`;
}

function onlyRoom(rows: readonly RoomRow[]): Room | null {
  if (rows.length > 1) {
    throw new ApplicationError(ROOM_PERSISTENCE_CONFLICT_CODE, false);
  }
  return rows[0] ? roomFromRow(rows[0]) : null;
}

function onlyRoomMembership(rows: readonly RoomMembershipRow[]): RoomMembership | null {
  if (rows.length > 1) {
    throw new ApplicationError(ROOM_PERSISTENCE_CONFLICT_CODE, false);
  }
  return rows[0] ? roomMembershipFromRow(rows[0]) : null;
}

function roomFromRow(row: RoomRow): Room {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    subtitle: row.subtitle,
    status: roomStatusFromDb(row.status),
    createdByActorId: row.created_by_actor_id,
    membershipVersion: nonNegativeNumberFromDb(row.membership_version),
    createdAtMs: nonNegativeNumberFromDb(row.created_at_ms),
    updatedAtMs: nonNegativeNumberFromDb(row.updated_at_ms),
    archivedAtMs: row.archived_at_ms === null ? null : nonNegativeNumberFromDb(row.archived_at_ms),
  };
}

function escapeLike(value: string): string { return value.replace(/[\\%_]/g, "\\$&"); }

function encodeNotificationReadThrough(value: DatabaseNumber): string {
  return Buffer.from(String(nonNegativeNumberFromDb(value)), "utf8").toString("base64url");
}

function roomMembershipFromRow(row: RoomMembershipRow): RoomMembership {
  return {
    id: row.id,
    roomId: row.room_id,
    companyId: row.company_id,
    actorId: row.actor_id,
    role: roomMembershipRoleFromDb(row.role),
    status: roomMembershipStatusFromDb(row.status),
    joinedAtMs: nonNegativeNumberFromDb(row.joined_at_ms),
    createdAtMs: nonNegativeNumberFromDb(row.created_at_ms),
    updatedAtMs: nonNegativeNumberFromDb(row.updated_at_ms),
  };
}

function roomListSummaryFromRow(row: RoomListSummaryRow): RoomListSummary {
  return {
    roomId: row.room_id,
    name: row.name,
    subtitle: row.subtitle,
    status: roomStatusFromDb(row.status),
    updatedAtMs: nonNegativeNumberFromDb(row.updated_at_ms),
    unreadCount: nonNegativeNumberFromDb(row.unread_count),
    readThrough: row.latest_notification_sequence === null
      ? null
      : encodeNotificationReadThrough(row.latest_notification_sequence),
  };
}

function roomFromProjectionRow(row: RoomMembershipProjectionRow): Room {
  return {
    id: row.room_id,
    companyId: row.room_company_id,
    name: row.room_name,
    subtitle: row.room_subtitle,
    status: roomStatusFromDb(row.room_status),
    createdByActorId: row.room_created_by_actor_id,
    membershipVersion: nonNegativeNumberFromDb(row.room_membership_version),
    createdAtMs: nonNegativeNumberFromDb(row.room_created_at_ms),
    updatedAtMs: nonNegativeNumberFromDb(row.room_updated_at_ms),
    archivedAtMs: row.room_archived_at_ms === null ? null : nonNegativeNumberFromDb(row.room_archived_at_ms),
  };
}

function roomMembershipFromProjectionRow(row: RoomMembershipProjectionRow): RoomMembership[] {
  if (
    row.membership_id === null
    || row.membership_room_id === null
    || row.membership_company_id === null
    || row.membership_actor_id === null
    || row.membership_role === null
    || row.membership_status === null
    || row.membership_joined_at_ms === null
    || row.membership_created_at_ms === null
    || row.membership_updated_at_ms === null
  ) {
    return [];
  }
  return [{
    id: row.membership_id,
    roomId: row.membership_room_id,
    companyId: row.membership_company_id,
    actorId: row.membership_actor_id,
    role: roomMembershipRoleFromDb(row.membership_role),
    status: roomMembershipStatusFromDb(row.membership_status),
    joinedAtMs: nonNegativeNumberFromDb(row.membership_joined_at_ms),
    createdAtMs: nonNegativeNumberFromDb(row.membership_created_at_ms),
    updatedAtMs: nonNegativeNumberFromDb(row.membership_updated_at_ms),
  }];
}

function roomStatusFromDb(value: string): RoomStatus {
  if (value === "active" || value === "archived") {
    return value;
  }
  throw new ApplicationError(ROOM_PERSISTENCE_UNAVAILABLE_CODE, true);
}

function roomMembershipRoleFromDb(value: string): RoomMembership["role"] {
  if (value === "owner" || value === "member") {
    return value;
  }
  throw new ApplicationError(ROOM_PERSISTENCE_UNAVAILABLE_CODE, true);
}

function roomMembershipStatusFromDb(value: string): RoomMembership["status"] {
  if (value === "active" || value === "inactive") {
    return value;
  }
  throw new ApplicationError(ROOM_PERSISTENCE_UNAVAILABLE_CODE, true);
}

function nonNegativeNumberFromDb(value: DatabaseNumber): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApplicationError(ROOM_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
    return value;
  }

  const normalized = typeof value === "bigint" ? value : parseDatabaseInteger(value);
  if (normalized < 0n || normalized > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ApplicationError(ROOM_PERSISTENCE_UNAVAILABLE_CODE, true);
  }
  return Number(normalized);
}

function parseDatabaseInteger(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new ApplicationError(ROOM_PERSISTENCE_UNAVAILABLE_CODE, true);
  }
  try {
    return BigInt(value);
  } catch {
    throw new ApplicationError(ROOM_PERSISTENCE_UNAVAILABLE_CODE, true);
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

function roomPersistenceError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }
  const code = postgresCode(error);
  return new ApplicationError(
    code === "23505" ? ROOM_PERSISTENCE_CONFLICT_CODE : ROOM_PERSISTENCE_UNAVAILABLE_CODE,
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
