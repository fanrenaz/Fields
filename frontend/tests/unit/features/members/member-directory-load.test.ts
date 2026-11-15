import assert from "node:assert/strict";
import test from "node:test";

import type {
  CompanyActor,
  CompanyInvitation,
} from "@fields/contracts/public/company";

import {
  loadMemberDirectory,
} from "../../../../features/members/member-directory-load";

test("members and invitations load in parallel", async () => {
  const calls: string[] = [];
  const members = deferred();
  const invitations = deferred();
  const promise = loadMemberDirectory({
    currentMembers: [],
    currentInvitations: [],
    loadMembers: async () => {
      calls.push("members");
      await members.promise;
      return [actor()];
    },
    loadInvitations: async () => {
      calls.push("invitations");
      await invitations.promise;
      return [invitation()];
    },
  });

  assert.deepEqual(calls, ["members", "invitations"]);
  invitations.resolve();
  members.resolve();
  const result = await promise;
  assert.equal(result.members.length, 1);
  assert.equal(result.invitations.length, 1);
});

test("invitation failure remains local and preserves loaded members", async () => {
  const result = await loadMemberDirectory({
    currentMembers: [],
    currentInvitations: [invitation()],
    loadMembers: async () => [actor()],
    loadInvitations: async () => {
      throw new Error("invitation unavailable");
    },
  });

  assert.equal(result.members[0]?.actor_id, "actor-one");
  assert.equal(result.invitations[0]?.invitation_credential, "invitation-one");
  assert.equal(result.memberError, null);
  assert.ok(result.invitationError instanceof Error);
});

function actor(): CompanyActor {
  return {
    actor_id: "actor-one",
    display_name: "Member",
    mark: "ME",
    email: "member@example.test",
    actor_type: "human",
    company_role: "member",
    status: "active",
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function invitation(): CompanyInvitation {
  return {
    status: "pending",
    invitation_credential: "invitation-one",
    email: "pending@example.test",
    created_at_ms: 1,
    expires_at_ms: 2,
  };
}
