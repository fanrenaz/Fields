import {
  AddRoomMember,
  CreateRoom,
  ListRoomMembers,
  ListRooms,
  RemoveRoomMember,
  type AddRoomMemberUseCase,
  type CreateRoomUseCase,
  type ListRoomMembersUseCase,
  type ListRoomsUseCase,
  type RemoveRoomMemberUseCase,
  type RoomAccessQuery,
  type RoomActorAccessQuery,
  type RoomMemberActorProfileQuery,
  type RoomMembershipQuery,
  type RoomQueryRepository,
} from "../../application/room/index.js";
import { SystemClock, UuidIdGenerator } from "../../infrastructure/configuration/index.js";
import {
  PostgresRoomRepository,
} from "../../infrastructure/persistence/postgres/repositories/index.js";
import {
  PostgresOwnerUnitOfWork,
  postgresTransactionForOwner,
} from "../../infrastructure/persistence/postgres/unit-of-work/index.js";
import type { BackendDatabase } from "../../infrastructure/persistence/postgres/database-service.js";

export type RoomApplicationDependencies = {
  database: BackendDatabase;
  actorAccess: RoomActorAccessQuery;
  memberActorProfiles: RoomMemberActorProfileQuery;
};

/**
 * Provider-neutral Room application surface for the eventual API transport.
 * PostgreSQL, event codecs, and concrete authorization adapters remain inside
 * this composition root.
 */
export type RoomApplication = {
  createRoom: CreateRoomUseCase;
  listRooms: ListRoomsUseCase;
  listRoomMembers: ListRoomMembersUseCase;
  addRoomMember: AddRoomMemberUseCase;
  removeRoomMember: RemoveRoomMemberUseCase;
  roomQueries: RoomQueryRepository;
  roomAccess: RoomAccessQuery;
  roomMembershipQuery: RoomMembershipQuery;
};

export function createRoomApplication(dependencies: RoomApplicationDependencies): RoomApplication {
  const clock = new SystemClock();
  const ids = new UuidIdGenerator();
  const roomUnitOfWork = new PostgresOwnerUnitOfWork(dependencies.database);
  const rooms = new PostgresRoomRepository(dependencies.database, postgresTransactionForOwner);
  const membershipDependencies = {
    roomCommands: rooms,
    roomAccess: rooms,
    actorAccess: dependencies.actorAccess,
    roomUnitOfWork,
    clock,
  };

  return {
    createRoom: new CreateRoom({
      roomCommands: rooms,
      roomUnitOfWork,
      actorAccess: dependencies.actorAccess,
      ids,
      clock,
    }),
    listRooms: new ListRooms({
      roomListProjections: rooms,
    }),
    listRoomMembers: new ListRoomMembers({
      roomQueries: rooms,
      roomAccess: rooms,
      memberActorProfiles: dependencies.memberActorProfiles,
    }),
    addRoomMember: new AddRoomMember(membershipDependencies),
    removeRoomMember: new RemoveRoomMember(membershipDependencies),
    roomQueries: rooms,
    roomAccess: rooms,
    roomMembershipQuery: rooms,
  };
}
