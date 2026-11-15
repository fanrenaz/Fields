import assert from "node:assert/strict";
import test from "node:test";

import {
  decideRoomMembershipChange,
  initialRoomMembershipVersion,
  membershipChangeIncrementsVersion,
  nextRoomMembershipVersion,
  RoomOwnerRemovalError,
  type RoomMembership,
} from "../../../../src/domain/room/index.js";

const activeMember: Pick<RoomMembership, "role" | "status"> = {
  role: "member",
  status: "active",
};

test("Room membership starts at version one and only real mutations advance it", () => {
  assert.equal(initialRoomMembershipVersion(), 1);
  assert.equal(nextRoomMembershipVersion(1, "unchanged"), 1);
  assert.equal(nextRoomMembershipVersion(1, "added"), 2);
  assert.equal(nextRoomMembershipVersion(2, "reactivated"), 3);
  assert.equal(nextRoomMembershipVersion(3, "removed"), 4);
  assert.equal(membershipChangeIncrementsVersion("unchanged"), false);
});

test("add and remove are idempotent when the canonical membership is unchanged", () => {
  assert.equal(decideRoomMembershipChange("add", null), "added");
  assert.equal(decideRoomMembershipChange("add", activeMember), "unchanged");
  assert.equal(decideRoomMembershipChange("add", { ...activeMember, status: "inactive" }), "reactivated");
  assert.equal(decideRoomMembershipChange("remove", null), "unchanged");
  assert.equal(decideRoomMembershipChange("remove", { ...activeMember, status: "inactive" }), "unchanged");
  assert.equal(decideRoomMembershipChange("remove", activeMember), "removed");
});

test("the Room owner is protected from an ordinary active removal", () => {
  assert.throws(
    () => decideRoomMembershipChange("remove", { role: "owner", status: "active" }),
    RoomOwnerRemovalError,
  );
});

test("Room membership version must remain a non-negative safe integer", () => {
  assert.throws(() => nextRoomMembershipVersion(-1, "unchanged"), RangeError);
  assert.throws(() => nextRoomMembershipVersion(Number.MAX_SAFE_INTEGER + 1, "unchanged"), RangeError);
});
