import assert from "node:assert/strict";
import test from "node:test";

import type { BackendDatabase } from "../../../../../src/infrastructure/persistence/postgres/database-service.js";

import {
  BetterAuthOrganizationGateway,
  BetterAuthOrganizationGatewayError,
  type BetterAuthOrganizationApi,
} from "../../../../../src/infrastructure/auth/better-auth/organization-gateway.js";

test("organization gateway creates the Better Auth organization through a provider-neutral input", async () => {
  const calls: unknown[] = [];
  const auth: BetterAuthOrganizationApi = {
    api: {
      createOrganization: async (input) => {
        calls.push(input);
        return { id: "organization_1" };
      },
    },
  };
  const gateway = new BetterAuthOrganizationGateway(auth, {} as BackendDatabase, () => "company-fixed");

  assert.deepEqual(await gateway.createOrganization({ name: "Acme", ownerUserId: "user_1" }), {
    organizationId: "organization_1",
  });
  assert.deepEqual(calls, [{
    body: {
      name: "Acme",
      slug: "company-fixed",
      userId: "user_1",
      keepCurrentActiveOrganization: true,
    },
  }]);
});

test("organization gateway strips provider failures and malformed IDs", async () => {
  const gateway = new BetterAuthOrganizationGateway({
    api: { createOrganization: async () => ({ id: "" }) },
  }, {} as BackendDatabase, () => "company-fixed");

  await assert.rejects(
    gateway.createOrganization({ name: "Acme", ownerUserId: "user_1" }),
    BetterAuthOrganizationGatewayError,
  );
});

test("organization gateway resolves only the exact sole Better Auth membership role", async () => {
  const gateway = new BetterAuthOrganizationGateway(
    noOpAuthApi(),
    databaseWithMembershipRows([{ role: "member" }]),
    () => "company-fixed",
  );

  assert.deepEqual(await gateway.resolveMembership({
    organizationId: "organization_one",
    userId: "user_one",
  }), { role: "member" });
});

test("organization membership authority fails closed for missing, duplicate, malformed, and unavailable rows", async () => {
  for (const rows of [
    [],
    [{ role: "owner" }, { role: "owner" }],
    [{ role: "admin" }],
  ]) {
    const gateway = new BetterAuthOrganizationGateway(
      noOpAuthApi(),
      databaseWithMembershipRows(rows),
      () => "company-fixed",
    );
    assert.equal(await gateway.resolveMembership({
      organizationId: "organization_one",
      userId: "user_one",
    }), null);
  }

  const unavailable = new BetterAuthOrganizationGateway(
    noOpAuthApi(),
    databaseWithMembershipFailure(new Error("postgres://secret@database/fields")),
    () => "company-fixed",
  );
  await assert.rejects(
    unavailable.resolveMembership({ organizationId: "organization_one", userId: "user_one" }),
    BetterAuthOrganizationGatewayError,
  );

  const malformedInput = new BetterAuthOrganizationGateway(
    noOpAuthApi(),
    databaseWithMembershipRows([{ role: "owner" }]),
    () => "company-fixed",
  );
  await assert.rejects(
    malformedInput.resolveMembership({ organizationId: " organization_one", userId: "user_one" }),
    BetterAuthOrganizationGatewayError,
  );
});

function noOpAuthApi(): BetterAuthOrganizationApi {
  return {
    api: {
      createOrganization: async () => ({ id: "organization_unused" }),
    },
  };
}

function databaseWithMembershipRows(rows: unknown[]): BackendDatabase {
  return {
    select: (() => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    })) as unknown as BackendDatabase["select"],
  } as BackendDatabase;
}

function databaseWithMembershipFailure(error: Error): BackendDatabase {
  return {
    select: (() => ({
      from: () => ({
        where: () => ({
          limit: async () => { throw error; },
        }),
      }),
    })) as unknown as BackendDatabase["select"],
  } as BackendDatabase;
}
