import {
  decideRoomMembershipChange,
  nextRoomMembershipVersion,
  RoomOwnerRemovalError,
  type RoomMembership,
  type RoomMembershipMutation,
} from "../../../domain/room/index.js";
import { ApplicationError, isApplicationError } from "../../platform/errors.js";
import type { Clock, OwnerUnitOfWork } from "../../platform/ports/index.js";

import type {
  RoomAccessQuery,
  RoomActorAccessQuery,
  RoomCommandRepository,
} from "../ports/index.js";
import { ROOM_ACTOR_ACCESS_DENIED_CODE } from "../ports/index.js";

export const ROOM_MEMBER_ACTOR_INVALID_CODE = "ROOM_MEMBER_ACTOR_INVALID";
export const ROOM_MEMBERSHIP_CONFLICT_CODE = "ROOM_MEMBERSHIP_CONFLICT";
export const ROOM_OWNER_REMOVAL_FORBIDDEN_CODE = "ROOM_OWNER_REMOVAL_FORBIDDEN";
export const ROOM_MEMBERSHIP_MUTATION_FAILED_CODE = "ROOM_MEMBERSHIP_MUTATION_FAILED";

export type RoomMembershipCommandInput = {
  roomId: string;
  actorId: string;
  requestedByActorId: string;
};

export type RoomMembershipCommandDependencies = {
  roomCommands: RoomCommandRepository;
  roomAccess: RoomAccessQuery;
  actorAccess: RoomActorAccessQuery;
  roomUnitOfWork: OwnerUnitOfWork;
  clock: Clock;
};

export interface AddRoomMemberUseCase {
  execute(input: RoomMembershipCommandInput): Promise<RoomMembership>;
}

export interface RemoveRoomMemberUseCase {
  execute(input: RoomMembershipCommandInput): Promise<RoomMembership | null>;
}

export class AddRoomMember implements AddRoomMemberUseCase {
  constructor(private readonly dependencies: RoomMembershipCommandDependencies) {}

  async execute(input: RoomMembershipCommandInput): Promise<RoomMembership> {
    const membership = await executeRoomMembershipMutation(this.dependencies, input, "add");
    if (membership === null) {
      throw new ApplicationError(ROOM_MEMBERSHIP_CONFLICT_CODE, true);
    }
    return membership;
  }
}

export class RemoveRoomMember implements RemoveRoomMemberUseCase {
  constructor(private readonly dependencies: RoomMembershipCommandDependencies) {}

  async execute(input: RoomMembershipCommandInput): Promise<RoomMembership | null> {
    return executeRoomMembershipMutation(this.dependencies, input, "remove");
  }
}

async function executeRoomMembershipMutation(
  dependencies: RoomMembershipCommandDependencies,
  input: RoomMembershipCommandInput,
  mutation: RoomMembershipMutation,
): Promise<RoomMembership | null> {
  try {
    const roomAccess = await dependencies.roomAccess.requireOwner({
      roomId: input.roomId,
      actorId: input.requestedByActorId,
    });
    const targetActor = await dependencies.actorAccess.requireActiveOrdinaryActor({
      actorId: input.actorId,
      companyId: roomAccess.companyId,
    });
    if (targetActor.actorId !== input.actorId || targetActor.companyId !== roomAccess.companyId) {
      throw new ApplicationError(ROOM_MEMBER_ACTOR_INVALID_CODE, false);
    }

    const nowMs = dependencies.clock.now();
    return await dependencies.roomUnitOfWork.execute("room", async (transaction) => {
      const state = await dependencies.roomCommands.readMembershipForMutation(transaction, {
        roomId: input.roomId,
        actorId: input.actorId,
      });
      if (state === null || state.room.companyId !== roomAccess.companyId) {
        throw new ApplicationError(ROOM_MEMBERSHIP_CONFLICT_CODE, true);
      }

      const change = decideRoomMembershipChange(mutation, state.membership);
      if (change === "unchanged") {
        return state.membership;
      }

      const membershipVersion = nextRoomMembershipVersion(state.room.membershipVersion, change);
      const membership = await dependencies.roomCommands.applyMembershipChange(transaction, {
        roomId: state.room.id,
        actorId: input.actorId,
        change,
        membershipVersion,
        joinedAtMs: nowMs,
        updatedAtMs: nowMs,
        actorType: targetActor.actorType,
      });
      if (membership === null) {
        throw new ApplicationError(ROOM_MEMBERSHIP_CONFLICT_CODE, true);
      }
      return membership;
    });
  } catch (error) {
    if (error instanceof RoomOwnerRemovalError) {
      throw new ApplicationError(ROOM_OWNER_REMOVAL_FORBIDDEN_CODE, false);
    }
    if (isApplicationError(error)) {
      if (error.code === ROOM_ACTOR_ACCESS_DENIED_CODE) {
        throw new ApplicationError(ROOM_MEMBER_ACTOR_INVALID_CODE, false);
      }
      throw error;
    }
    throw new ApplicationError(ROOM_MEMBERSHIP_MUTATION_FAILED_CODE, true);
  }
}
