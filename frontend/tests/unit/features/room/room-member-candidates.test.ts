import assert from "node:assert/strict";
import test from "node:test";

import type {
  CompanyActor,
} from "@fields/contracts/public/company";
import type {
  RoomMember,
} from "@fields/contracts/public/room";
import {
  canManageRoomMembers,
  canRemoveRoomMember,
  roomMemberCandidates,
} from "../../../../features/room/room-member-candidates";

test("Room member candidates preserve Company order and exclude inactive or existing Actors", () => {
  const owner = companyActor("actor_owner", "Owner", "OW", "human", "active");
  const human = companyActor("actor_human", "Human", "HU", "human", "active");
  const agent = companyActor("actor_agent", "Agent", "AG", "agent", "active");
  const inactive = companyActor("actor_inactive", "Inactive", "IN", "agent", "inactive");

  assert.deepEqual(
    roomMemberCandidates([owner, human, agent, inactive], [roomMember(owner.actor_id, "owner")]),
    [human, agent],
  );
});

test("only the active current Room owner can manage Room members", () => {
  const owner = roomMember("actor_owner", "owner");
  const member = roomMember("actor_member", "member");

  assert.equal(canManageRoomMembers("actor_owner", [owner, member]), true);
  assert.equal(canManageRoomMembers("actor_member", [owner, member]), false);
  assert.equal(canManageRoomMembers("actor_company_owner", [owner, member]), false);
  assert.equal(canManageRoomMembers("actor_owner", [{ ...owner, status: "inactive" }]), false);
});

test("the Room owner row is never removable", () => {
  assert.equal(canRemoveRoomMember(true, roomMember("actor_owner", "owner")), false);
  assert.equal(canRemoveRoomMember(true, roomMember("actor_member", "member")), true);
  assert.equal(canRemoveRoomMember(false, roomMember("actor_member", "member")), false);
});

function companyActor(
  actorId: string,
  displayName: string,
  mark: string,
  actorType: "human" | "agent",
  status: "active" | "inactive",
): CompanyActor {
  return {
    actor_id: actorId,
    display_name: displayName,
    mark,
    email: actorType === "human" ? `${actorId}@example.test` : null,
    actor_type: actorType,
    company_role: actorId === "actor_owner" ? "owner" : "member",
    status,
  };
}

function roomMember(actorId: string, role: string): RoomMember {
  return {
    member_id: actorId,
    name: actorId,
    mark: actorId.slice(-2).toUpperCase(),
    role,
    meta: "human",
    actor_type: "human",
    status: "active",
    joined_at_ms: 1,
    membership_version: 1,
  };
}
