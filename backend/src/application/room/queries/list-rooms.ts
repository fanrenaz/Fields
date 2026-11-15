import { ApplicationError, isApplicationError } from "../../platform/errors.js";

import type {
  RoomListCursor,
  RoomListProjectionQuery,
  RoomListSummary,
} from "../ports/index.js";

export const ROOM_LIST_FAILED_CODE = "ROOM_LIST_FAILED";
export const ROOM_LIST_PROJECTION_INVALID_CODE = "ROOM_LIST_PROJECTION_INVALID";

export type ListRoomsInput = {
  companyId: string;
  actorId: string;
  cursor?: string | null;
  limit?: number;
  includeArchived?: boolean;
  searchTerm?: string;
};

export type RoomListPage = {
  items: readonly RoomListSummary[];
  page: {
    nextCursor: string | null;
  };
};

export type ListRoomsDependencies = {
  roomListProjections: RoomListProjectionQuery;
};

export interface ListRoomsUseCase {
  execute(input: ListRoomsInput): Promise<RoomListPage>;
}

/**
 * Provider-neutral Room summary page that preserves the public list contract:
 * active-membership visibility, opaque base64url cursor shape, descending
 * update time / ascending Room ID ordering, and archived inclusion semantics.
 */
export class ListRooms implements ListRoomsUseCase {
  constructor(private readonly dependencies: ListRoomsDependencies) {}

  async execute(input: ListRoomsInput): Promise<RoomListPage> {
    try {
      const limit = roomListLimit(input.limit);
      const rows = await this.dependencies.roomListProjections.listVisibleRoomSummaries({
        companyId: input.companyId,
        actorId: input.actorId,
        cursor: decodeRoomListCursor(input.cursor),
        limit,
        includeArchived: input.includeArchived === true,
        searchTerm: input.searchTerm,
      });
      assertRoomListRows(rows, limit, input.includeArchived === true);

      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        items: Object.freeze(items),
        page: {
          nextCursor: rows.length > limit && last
            ? encodeRoomListCursor({ updatedAtMs: last.updatedAtMs, roomId: last.roomId })
            : null,
        },
      };
    } catch (error) {
      if (isApplicationError(error)) {
        throw error;
      }
      throw new ApplicationError(ROOM_LIST_FAILED_CODE, true);
    }
  }
}

function assertRoomListRows(
  rows: readonly RoomListSummary[],
  limit: number,
  includeArchived: boolean,
): void {
  if (rows.length > limit + 1) {
    throw invalidProjection();
  }

  let previous: RoomListSummary | null = null;
  const seen = new Set<string>();
  for (const row of rows) {
    if (
      !isNonEmptyString(row.roomId)
      || !isNonEmptyString(row.name)
      || (row.subtitle !== null && typeof row.subtitle !== "string")
      || (row.status !== "active" && row.status !== "archived")
      || (!includeArchived && row.status !== "active")
      || !isNonNegativeSafeInteger(row.updatedAtMs)
      || !isNonNegativeSafeInteger(row.unreadCount)
      || seen.has(row.roomId)
      || (previous !== null && compareRoomListRows(previous, row) > 0)
    ) {
      throw invalidProjection();
    }
    seen.add(row.roomId);
    previous = row;
  }
}

/** Returns positive when the left row must appear after the right row. */
function compareRoomListRows(left: RoomListSummary, right: RoomListSummary): number {
  if (left.updatedAtMs !== right.updatedAtMs) {
    return right.updatedAtMs - left.updatedAtMs;
  }
  return left.roomId.localeCompare(right.roomId);
}

function roomListLimit(limit: number | undefined): number {
  if (!limit) {
    return 50;
  }
  return Math.max(1, Math.min(limit, 100));
}

function encodeRoomListCursor(cursor: RoomListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeRoomListCursor(cursor: string | null | undefined): RoomListCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<RoomListCursor>;
    return typeof value.updatedAtMs === "number"
      && Number.isFinite(value.updatedAtMs)
      && typeof value.roomId === "string"
      && value.roomId.length > 0
      ? { updatedAtMs: value.updatedAtMs, roomId: value.roomId }
      : null;
  } catch {
    return null;
  }
}

function invalidProjection(): ApplicationError {
  return new ApplicationError(ROOM_LIST_PROJECTION_INVALID_CODE, false);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
