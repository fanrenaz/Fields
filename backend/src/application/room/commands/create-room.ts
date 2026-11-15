import { initialRoomMembershipVersion, type Room } from "../../../domain/room/index.js";
import { ApplicationError, isApplicationError } from "../../platform/errors.js";
import type { Clock, IdGenerator, OwnerUnitOfWork } from "../../platform/ports/index.js";

import {
  ROOM_ACTOR_ACCESS_DENIED_CODE,
  type RoomActorAccessQuery,
  type RoomCommandRepository,
} from "../ports/index.js";

export const ROOM_CREATOR_INVALID_CODE = "ROOM_CREATOR_INVALID";
export const ROOM_CREATION_FAILED_CODE = "ROOM_CREATION_FAILED";

export type CreateRoomInput = {
  companyId: string;
  ownerActorId: string;
  name: string;
  subtitle?: string | null;
};

export type CreateRoomDependencies = {
  roomCommands: RoomCommandRepository;
  roomUnitOfWork: OwnerUnitOfWork;
  actorAccess: RoomActorAccessQuery;
  ids: IdGenerator;
  clock: Clock;
};

export interface CreateRoomUseCase {
  execute(input: CreateRoomInput): Promise<Room>;
}

/**
 * Creates the Room aggregate and its one initial active owner in a single
 * Room transaction. Initial membership version one is baseline state, not a
 * membership-change Event for a Runtime that does not exist yet.
 */
export class CreateRoom implements CreateRoomUseCase {
  constructor(private readonly dependencies: CreateRoomDependencies) {}

  async execute(input: CreateRoomInput): Promise<Room> {
    try {
      const owner = await this.dependencies.actorAccess.requireActiveOrdinaryActor({
        actorId: input.ownerActorId,
        companyId: input.companyId,
      });
      if (owner.actorId !== input.ownerActorId || owner.companyId !== input.companyId) {
        throw new ApplicationError(ROOM_CREATOR_INVALID_CODE, false);
      }
      if (owner.actorType !== "human") {
        throw new ApplicationError(ROOM_CREATOR_INVALID_CODE, false);
      }
      const nowMs = this.dependencies.clock.now();
      const room: Room = {
        id: this.dependencies.ids.next("room"),
        companyId: input.companyId,
        name: input.name,
        subtitle: input.subtitle ?? null,
        status: "active",
        createdByActorId: input.ownerActorId,
        membershipVersion: initialRoomMembershipVersion(),
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        archivedAtMs: null,
      };

      await this.dependencies.roomUnitOfWork.execute("room", async (transaction) => {
        await this.dependencies.roomCommands.create(transaction, room, {
          roomId: room.id,
          companyId: room.companyId,
          actorId: input.ownerActorId,
          role: "owner",
          status: "active",
          joinedAtMs: nowMs,
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
        });
      });
      return room;
    } catch (error) {
      if (isApplicationError(error)) {
        if (error.code === ROOM_ACTOR_ACCESS_DENIED_CODE) {
          throw new ApplicationError(ROOM_CREATOR_INVALID_CODE, false);
        }
        throw error;
      }
      throw new ApplicationError(ROOM_CREATION_FAILED_CODE, true);
    }
  }
}
