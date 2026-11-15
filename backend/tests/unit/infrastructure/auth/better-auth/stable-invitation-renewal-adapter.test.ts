import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedInvitationRenewalCredential,
  preserveExpiredInvitationIdentityForRenewal,
  runWithInvitationRenewalExpectation,
} from "../../../../../src/infrastructure/auth/better-auth/stable-invitation-renewal-adapter.js";

const now = new Date("2026-07-27T12:00:00.000Z");

test("expired invitation identity lookup preserves the bearer and exposes it to resend", async () => {
  const expiredInvitation = {
    id: "invitation-existing",
    email: "member@example.com",
    organizationId: "organization-1",
    status: "pending",
    createdAt: new Date("2026-07-25T12:00:00.000Z"),
    expiresAt: new Date("2026-07-26T12:00:00.000Z"),
  };
  const activeInvitation = {
    ...expiredInvitation,
    id: "invitation-active",
    createdAt: new Date("2026-07-24T12:00:00.000Z"),
    expiresAt: new Date("2026-07-28T12:00:00.000Z"),
  };
  const adapter = createAdapter([expiredInvitation, activeInvitation]);

  const invitations = await adapter.findMany<typeof expiredInvitation>({
    model: "invitation",
    where: [
      { field: "email", value: "member@example.com" },
      { field: "organizationId", value: "organization-1" },
      { field: "status", value: "pending" },
    ],
  });

  assert.equal(invitations.length, 1);
  assert.equal(invitations[0], activeInvitation);
  assert.equal(expiredInvitation.expiresAt.toISOString(), "2026-07-26T12:00:00.000Z");
});

test("duplicate expired invitations renew the oldest stable bearer", async () => {
  const older = {
    id: "invitation-older",
    email: "member@example.com",
    organizationId: "organization-1",
    status: "pending",
    createdAt: new Date("2026-07-24T12:00:00.000Z"),
    expiresAt: new Date("2026-07-25T12:00:00.000Z"),
  };
  const newer = {
    ...older,
    id: "invitation-newer",
    createdAt: new Date("2026-07-25T12:00:00.000Z"),
    expiresAt: new Date("2026-07-26T12:00:00.000Z"),
  };
  const adapter = createAdapter([newer, older]);

  const invitations = await adapter.findMany<typeof older>({
    model: "invitation",
    where: [
      { field: "email", value: "member@example.com" },
      { field: "organizationId", value: "organization-1" },
      { field: "status", value: "pending" },
    ],
  });

  assert.equal(invitations.length, 1);
  assert.equal(invitations[0]?.id, older.id);
  assert.equal(invitations[0]?.expiresAt > now, true);
});

test("canonical renewal identity does not change when an older active invitation expires", async () => {
  const canonical = {
    id: "invitation-canonical",
    email: "member@example.com",
    organizationId: "organization-1",
    status: "pending",
    createdAt: new Date("2026-07-24T12:00:00.000Z"),
    expiresAt: new Date("2026-07-28T12:00:00.000Z"),
  };
  const duplicate = {
    ...canonical,
    id: "invitation-duplicate",
    createdAt: new Date("2026-07-25T12:00:00.000Z"),
    expiresAt: new Date("2026-07-26T12:00:00.000Z"),
  };
  const query = {
    model: "invitation",
    where: [
      { field: "email", value: "member@example.com" },
      { field: "organizationId", value: "organization-1" },
      { field: "status", value: "pending" },
    ],
  };

  const beforeExpiry = await createAdapter(
    [duplicate, canonical],
    new Date("2026-07-27T12:00:00.000Z"),
  ).findMany<typeof canonical>(query);
  const afterExpiry = await createAdapter(
    [duplicate, canonical],
    new Date("2026-07-29T12:00:00.000Z"),
  ).findMany<typeof canonical>(query);

  assert.equal(beforeExpiry[0]?.id, canonical.id);
  assert.equal(afterExpiry[0]?.id, canonical.id);
});

test("request-bound renewal selects only the supplied bearer and never substitutes a duplicate", async () => {
  const selected = {
    id: "invitation-selected",
    email: "member@example.com",
    organizationId: "organization-1",
    status: "pending",
    createdAt: new Date("2026-07-25T12:00:00.000Z"),
    expiresAt: new Date("2026-07-26T12:00:00.000Z"),
  };
  const duplicate = {
    ...selected,
    id: "invitation-duplicate",
    createdAt: new Date("2026-07-24T12:00:00.000Z"),
  };
  const adapter = createAdapter([duplicate, selected]);
  const query = pendingInvitationLookup();

  const invitations = await runWithInvitationRenewalExpectation(
    selected.id,
    () => adapter.findMany<typeof selected>(query),
  );
  const missing = await runWithInvitationRenewalExpectation(
    "invitation-revoked",
    () => adapter.findMany<typeof selected>(query),
  );

  assert.equal(invitations.length, 1);
  assert.equal(invitations[0]?.id, selected.id);
  assert.equal(invitations[0]?.expiresAt > now, true);
  assert.deepEqual(missing, []);
  assert.equal(expectedInvitationRenewalCredential(), null);
});

test("request-bound renewal update adds an atomic pending-state guard", async () => {
  const updates: unknown[] = [];
  const baseFactory = (() => ({
    async findMany<T>() {
      return [] as T[];
    },
    async update<T>(query: unknown) {
      updates.push(query);
      return null as T | null;
    },
  })) as never;
  const adapter = preserveExpiredInvitationIdentityForRenewal(
    baseFactory,
    () => new Date(now),
  )({} as never);

  await runWithInvitationRenewalExpectation("invitation-selected", () => (
    adapter.update({
      model: "invitation",
      where: [{ field: "id", value: "invitation-selected" }],
      update: { expiresAt: new Date("2026-07-29T12:00:00.000Z") },
    })
  ));

  assert.deepEqual(updates, [{
    model: "invitation",
    where: [
      { field: "id", value: "invitation-selected" },
      { field: "status", value: "pending" },
    ],
    update: { expiresAt: new Date("2026-07-29T12:00:00.000Z") },
  }]);
});

test("Organization-wide invitation lists continue to observe persisted expiry", async () => {
  const expiredInvitation = {
    id: "invitation-existing",
    expiresAt: new Date("2026-07-26T12:00:00.000Z"),
  };
  const adapter = createAdapter([expiredInvitation]);

  const invitations = await adapter.findMany<typeof expiredInvitation>({
    model: "invitation",
    where: [
      { field: "organizationId", value: "organization-1" },
      { field: "status", value: "pending" },
    ],
  });

  assert.equal(invitations[0], expiredInvitation);
  assert.equal(invitations[0]?.expiresAt.toISOString(), "2026-07-26T12:00:00.000Z");
});

test("near-matching queries are not treated as invitation renewal lookups", async () => {
  const expiredInvitation = {
    id: "invitation-existing",
    expiresAt: new Date("2026-07-26T12:00:00.000Z"),
  };
  const adapter = createAdapter([expiredInvitation]);

  const invitations = await adapter.findMany<typeof expiredInvitation>({
    model: "invitation",
    where: [
      { field: "email", value: "member@example.com" },
      { field: "organizationId", value: "organization-1" },
      { field: "status", value: "pending" },
    ],
    select: ["id", "expiresAt"],
  });

  assert.equal(invitations[0], expiredInvitation);
});

function createAdapter(rows: unknown[], currentTime = now) {
  const baseFactory = (() => ({
    async findMany<T>() {
      return rows as T[];
    },
  })) as never;
  return preserveExpiredInvitationIdentityForRenewal(
    baseFactory,
    () => new Date(currentTime),
  )({} as never);
}

function pendingInvitationLookup() {
  return {
    model: "invitation",
    where: [
      { field: "email", value: "member@example.com" },
      { field: "organizationId", value: "organization-1" },
      { field: "status", value: "pending" },
    ],
  };
}
