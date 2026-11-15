import { ApplicationError, isApplicationError } from "../../platform/errors.js";

import type {
  RoomAccessQuery,
  RoomMemberActorProfile,
  RoomMemberActorProfileQuery,
  RoomQueryRepository,
} from "../ports/index.js";

export const ROOM_MEMBERS_LIST_FAILED_CODE = "ROOM_MEMBERS_LIST_FAILED";
export const ROOM_MEMBERS_LIST_PROJECTION_INVALID_CODE = "ROOM_MEMBERS_LIST_PROJECTION_INVALID";

const ROOM_ACCESS_DENIED_CODE = "ROOM_ACCESS_DENIED";

export type ListRoomMembersInput = {
  companyId: string;
  roomId: string;
  actorId: string;
};

export type RoomMemberReadProjection = {
  actorId: string;
  displayName: string;
  mark: string;
  role: "owner" | "member";
  meta: "human" | "agent";
  joinedAtMs: number;
  actorType: "human" | "agent";
  status: "active";
  membershipVersion: number;
};

export type RoomMembersReadProjection = {
  roomId: string;
  items: readonly RoomMemberReadProjection[];
};

export type ListRoomMembersDependencies = {
  roomQueries: RoomQueryRepository;
  roomAccess: RoomAccessQuery;
  memberActorProfiles: RoomMemberActorProfileQuery;
};

export interface ListRoomMembersUseCase {
  execute(input: ListRoomMembersInput): Promise<RoomMembersReadProjection>;
}

/**
 * Room owns membership order and roles; Actor owns profile eligibility and
 * display facts. This use case combines those two public projections only
 * after Room member access succeeds, preserving the active Actor inner-join
 * behavior without a cross-owner persistence join.
 */
export class ListRoomMembers implements ListRoomMembersUseCase {
  constructor(private readonly dependencies: ListRoomMembersDependencies) {}

  async execute(input: ListRoomMembersInput): Promise<RoomMembersReadProjection> {
    try {
      const access = await this.dependencies.roomAccess.requireMember({
        roomId: input.roomId,
        actorId: input.actorId,
      });
      if (
        access.roomId !== input.roomId
        || access.companyId !== input.companyId
        || access.actorId !== input.actorId
      ) {
        throw new ApplicationError(ROOM_ACCESS_DENIED_CODE, false);
      }

      const memberships = await this.dependencies.roomQueries.listActiveMembers(input.roomId);
      const activeMemberships = requiredActiveMemberships(memberships, input);
      if (activeMemberships.length === 0) {
        return { roomId: input.roomId, items: Object.freeze([]) };
      }

      const actorIds = activeMemberships.map((membership) => membership.actorId);
      const profiles = await this.dependencies.memberActorProfiles.listActiveOrdinaryProfiles({
        companyId: input.companyId,
        actorIds,
      });
      const profileByActorId = validProfilesByActorId(profiles, input.companyId, actorIds);
      const membershipVersion = await this.dependencies.roomQueries.currentMembershipVersion(input.roomId);
      if (membershipVersion === null || membershipVersion < 1) throw invalidProjection();
      return {
        roomId: input.roomId,
        items: Object.freeze(activeMemberships.flatMap((membership) => {
          const profile = profileByActorId.get(membership.actorId);
          return profile === undefined ? [] : [projectMember(membership, profile, membershipVersion)];
        })),
      };
    } catch (error) {
      if (isApplicationError(error)) {
        throw error;
      }
      throw new ApplicationError(ROOM_MEMBERS_LIST_FAILED_CODE, true);
    }
  }
}

function requiredActiveMemberships(
  memberships: readonly {
    roomId: string;
    companyId: string;
    actorId: string;
    role: "owner" | "member";
    status: "active" | "inactive";
    joinedAtMs: number;
  }[],
  input: ListRoomMembersInput,
) {
  const seen = new Set<string>();
  let previous: {
    actorId: string;
    joinedAtMs: number;
  } | null = null;
  for (const membership of memberships) {
    if (
      membership.roomId !== input.roomId
      || membership.companyId !== input.companyId
      || membership.status !== "active"
      || !isNonEmptyString(membership.actorId)
      || (membership.role !== "owner" && membership.role !== "member")
      || !isNonNegativeSafeInteger(membership.joinedAtMs)
      || seen.has(membership.actorId)
      || (previous !== null && compareMembershipOrder(previous, membership) > 0)
    ) {
      throw invalidProjection();
    }
    seen.add(membership.actorId);
    previous = membership;
  }
  return memberships;
}

/** Matches the legacy Room member projection: joined timestamp, then Actor ID. */
function compareMembershipOrder(
  left: { actorId: string; joinedAtMs: number },
  right: { actorId: string; joinedAtMs: number },
): number {
  if (left.joinedAtMs !== right.joinedAtMs) {
    return left.joinedAtMs - right.joinedAtMs;
  }
  return left.actorId.localeCompare(right.actorId);
}

function validProfilesByActorId(
  profiles: readonly RoomMemberActorProfile[],
  companyId: string,
  actorIds: readonly string[],
): ReadonlyMap<string, RoomMemberActorProfile> {
  const expected = new Set(actorIds);
  const result = new Map<string, RoomMemberActorProfile>();
  for (const profile of profiles) {
    if (
      !expected.has(profile.actorId)
      || result.has(profile.actorId)
      || profile.companyId !== companyId
      || !isNonEmptyString(profile.displayName)
      || !isNonEmptyString(profile.mark)
      || (profile.actorType !== "human" && profile.actorType !== "agent")
    ) {
      throw invalidProjection();
    }
    result.set(profile.actorId, profile);
  }
  return result;
}

function projectMember(
  membership: {
    actorId: string;
    role: "owner" | "member";
    joinedAtMs: number;
  },
  profile: RoomMemberActorProfile,
  membershipVersion: number,
): RoomMemberReadProjection {
  return {
    actorId: membership.actorId,
    displayName: profile.displayName,
    mark: profile.mark,
    role: membership.role,
    meta: profile.actorType,
    joinedAtMs: membership.joinedAtMs,
    actorType: profile.actorType,
    status: "active",
    membershipVersion,
  };
}

function invalidProjection(): ApplicationError {
  return new ApplicationError(ROOM_MEMBERS_LIST_PROJECTION_INVALID_CODE, false);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
