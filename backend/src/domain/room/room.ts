export const roomStatuses = ["active", "archived"] as const;
export const roomMembershipRoles = ["owner", "member"] as const;
export const roomMembershipStatuses = ["active", "inactive"] as const;

export type RoomStatus = typeof roomStatuses[number];
export type RoomMembershipRole = typeof roomMembershipRoles[number];
export type RoomMembershipStatus = typeof roomMembershipStatuses[number];

export type Room = {
  id: string;
  companyId: string;
  name: string;
  subtitle: string | null;
  status: RoomStatus;
  createdByActorId: string;
  membershipVersion: number;
  createdAtMs: number;
  updatedAtMs: number;
  archivedAtMs: number | null;
};

export type RoomMembership = {
  id: string;
  roomId: string;
  companyId: string;
  actorId: string;
  role: RoomMembershipRole;
  status: RoomMembershipStatus;
  joinedAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type RoomMembershipMutation = "add" | "remove";
export type RoomMembershipChange = "added" | "reactivated" | "removed" | "unchanged";

/** A freshly created Room contains its creator as the unique active owner. */
export function initialRoomMembershipVersion(): number {
  return 1;
}

/**
 * Decides whether a requested mutation changes the canonical active membership
 * projection. Application code persists the resulting status and places the
 * matching membership event in the same transaction.
 */
export function decideRoomMembershipChange(
  mutation: RoomMembershipMutation,
  existingMembership: Pick<RoomMembership, "role" | "status"> | null,
): RoomMembershipChange {
  if (mutation === "add") {
    if (!existingMembership) {
      return "added";
    }
    return existingMembership.status === "active" ? "unchanged" : "reactivated";
  }

  if (!existingMembership || existingMembership.status !== "active") {
    return "unchanged";
  }
  if (existingMembership.role === "owner") {
    throw new RoomOwnerRemovalError();
  }
  return "removed";
}

export function membershipChangeIncrementsVersion(change: RoomMembershipChange): boolean {
  return change !== "unchanged";
}

export function nextRoomMembershipVersion(currentVersion: number, change: RoomMembershipChange): number {
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
    throw new RangeError("Room membership version must be a non-negative safe integer.");
  }
  return membershipChangeIncrementsVersion(change) ? currentVersion + 1 : currentVersion;
}

export class RoomOwnerRemovalError extends Error {
  constructor() {
    super("A Room owner cannot be removed through the ordinary membership API.");
    this.name = "RoomOwnerRemovalError";
  }
}
