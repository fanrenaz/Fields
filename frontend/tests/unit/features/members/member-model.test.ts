import assert from "node:assert/strict";
import test from "node:test";
import type {
  CompanyActor,
  CompanyInvitation,
} from "@fields/contracts/public/company";

import {
  actorSelectionAfterRemoval,
  companyInvitationStatusAt,
  expireCompanyInvitationsAt,
  invitationSelectionAfterRevocation,
  renewedCompanyInvitation,
  serverInvitationAllowsCopy,
  sortCompanyActors,
  sortCompanyMemberDirectory,
  upsertCompanyActor,
} from "../../../../features/members/member-model";

const owner = actor({ actor_id: "actor-owner", display_name: "Zed", company_role: "owner" });
const alphaTwo = actor({ actor_id: "actor-2", display_name: "Alpha" });
const alphaOne = actor({ actor_id: "actor-1", display_name: "Alpha" });

test("company actors sort owner first then by display name and actor id", () => {
  const source = [alphaTwo, owner, alphaOne];
  const sorted = sortCompanyActors(source);
  assert.deepEqual(sorted.map((item) => item.actor_id), ["actor-owner", "actor-1", "actor-2"]);
  assert.deepEqual(source.map((item) => item.actor_id), ["actor-2", "actor-owner", "actor-1"]);
});

test("upsert preserves one actor and the stable directory order", () => {
  const updated = upsertCompanyActor([owner, alphaOne], {
    ...alphaOne,
    display_name: "Beta",
  });
  assert.equal(updated.length, 2);
  assert.equal(updated.find((item) => item.actor_id === alphaOne.actor_id)?.display_name, "Beta");
  assert.equal(updated[0]?.actor_id, owner.actor_id);
});

test("member directory keeps the Owner first and uniformly sorts members with invitations", () => {
  const entries = sortCompanyMemberDirectory(
    [
      actor({ actor_id: "actor-beta", display_name: "Beta" }),
      owner,
      actor({ actor_id: "actor-alpha", display_name: "Alpha" }),
    ],
    [
      invitation({ invitation_credential: "inv-zed", email: "zed@example.test" }),
      invitation({ invitation_credential: "inv-amber", email: "amber@example.test" }),
    ],
  );
  assert.deepEqual(entries.map((entry) => (
    entry.kind === "member" ? entry.member.actor_id : entry.invitation.invitation_credential
  )), [
    "actor-owner",
    "actor-alpha",
    "inv-amber",
    "actor-beta",
    "inv-zed",
  ]);
});

test("removing the selected actor falls back to the current user", () => {
  assert.equal(actorSelectionAfterRemoval("actor-2", "actor-2", "actor-owner"), "actor-owner");
  assert.equal(actorSelectionAfterRemoval("actor-1", "actor-2", "actor-owner"), "actor-1");
});

test("revoking the selected invitation safely falls back to the current member", () => {
  assert.deepEqual(
    invitationSelectionAfterRevocation("invitation-one", "invitation-one", "actor-owner"),
    { kind: "member", actorId: "actor-owner" },
  );
  assert.equal(
    invitationSelectionAfterRevocation("invitation-two", "invitation-one", "actor-owner"),
    null,
  );
});

test("an invitation becomes expired at the exact deadline and never becomes pending again", () => {
  const pending = invitation({ expires_at_ms: 200 });
  assert.equal(companyInvitationStatusAt(pending, 199), "pending");
  assert.equal(companyInvitationStatusAt(pending, 200), "expired");
  assert.equal(
    companyInvitationStatusAt(invitation({ status: "expired", expires_at_ms: 300 }), 100),
    "expired",
  );

  const unchanged = [pending];
  assert.equal(expireCompanyInvitationsAt(unchanged, 199), unchanged);
  assert.deepEqual(expireCompanyInvitationsAt(unchanged, 200), [{
    ...pending,
    status: "expired",
  }]);
});

test("copying requires a matching server-authoritative pending invitation", () => {
  const pending = invitation({
    invitation_credential: "invitation-pending",
  });
  const expired = invitation({
    invitation_credential: "invitation-expired",
    status: "expired",
  });

  assert.equal(
    serverInvitationAllowsCopy([pending, expired], "invitation-pending"),
    true,
  );
  assert.equal(
    serverInvitationAllowsCopy([pending, expired], "invitation-expired"),
    false,
  );
  assert.equal(serverInvitationAllowsCopy([pending, expired], "missing"), false);
});

test("renewal succeeds only when the same server-authoritative bearer remains pending", () => {
  const selected = invitation({
    invitation_credential: "invitation-selected",
    expires_at_ms: 300,
  });
  const replacement = invitation({
    invitation_credential: "invitation-replacement",
    expires_at_ms: 300,
  });

  assert.equal(
    renewedCompanyInvitation([replacement, selected], "invitation-selected", 200),
    selected,
  );
  assert.equal(
    renewedCompanyInvitation([replacement], "invitation-selected", 200),
    null,
  );
  assert.equal(
    renewedCompanyInvitation([selected], "invitation-selected", 300),
    null,
  );
});

function actor(overrides: Partial<CompanyActor>): CompanyActor {
  return {
    actor_id: "actor-default",
    display_name: "Member",
    mark: "ME",
    email: "member@example.com",
    actor_type: "human",
    company_role: "member",
    status: "active",
    ...overrides,
  };
}

function invitation(overrides: Partial<CompanyInvitation> = {}): CompanyInvitation {
  return {
    status: "pending",
    invitation_credential: "invitation-default",
    email: "invitee@example.test",
    created_at_ms: 1,
    expires_at_ms: 2,
    ...overrides,
  };
}
