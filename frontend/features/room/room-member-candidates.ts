import type {
  CompanyActor,
} from "@fields/contracts/public/company";
import type {
  RoomMember,
} from "@fields/contracts/public/room";

export function roomMemberCandidates(
  companyActors: readonly CompanyActor[],
  roomMembers: readonly RoomMember[],
): CompanyActor[] {
  const roomActorIds = new Set(
    roomMembers
      .map((member) => member.member_id),
  );
  return companyActors.filter((actor) => (
    actor.status === "active" && !roomActorIds.has(actor.actor_id)
  ));
}

export function canManageRoomMembers(
  currentActorId: string,
  roomMembers: readonly RoomMember[],
): boolean {
  return roomMembers.some((member) => (
    member.member_id === currentActorId && member.role === "owner" && member.status !== "inactive"
  ));
}

export function canRemoveRoomMember(
  canManage: boolean,
  member: RoomMember,
): boolean {
  return canManage && member.role !== "owner";
}
