import assert from "node:assert/strict";
import test from "node:test";

import type { BackendDatabase } from "../../../../../src/infrastructure/persistence/postgres/database-service.js";

import {
  BetterAuthProductSessionProjectionRepair,
  BetterAuthProductSessionProjectionRepairError,
  type HumanActorReconciliation,
} from "../../../../../src/infrastructure/auth/better-auth/product-session-projection-repair.js";

test("Product Session repair only reconciles one mapped active Better Auth membership", async () => {
  const calls: unknown[] = [];
  const repair = new BetterAuthProductSessionProjectionRepair(
    databaseWithSelectResults([
      [{ userId: "user_1", displayName: "Ada Lovelace" }],
      [{ organizationId: "organization_1", role: "member" }],
      [{ companyId: "company_1" }],
    ]),
    recordingReconciler(calls),
  );

  await repair.repair({ authUserId: "user_1", activeOrganizationId: "organization_1" });

  assert.deepEqual(calls, [{
    authUserId: "user_1",
    companyId: "company_1",
    displayName: "Ada Lovelace",
    companyRole: "member",
  }]);
});

test("Product Session repair leaves malformed or mismatched authority facts unresolved", async () => {
  const calls: unknown[] = [];
  const repair = new BetterAuthProductSessionProjectionRepair(
    databaseWithSelectResults([
      [{ userId: "user_1", displayName: "Ada Lovelace" }],
      [{ organizationId: "organization_other", role: "member" }],
      [{ companyId: "company_1" }],
    ]),
    recordingReconciler(calls),
  );

  await repair.repair({ authUserId: "user_1", activeOrganizationId: "organization_1" });

  assert.deepEqual(calls, []);
});

test("Product Session repair removes infrastructure causes", async () => {
  const repair = new BetterAuthProductSessionProjectionRepair({
    select: () => {
      throw new Error("postgres://secret@database/fields");
    },
  } as unknown as BackendDatabase, recordingReconciler([]));

  await assert.rejects(
    repair.repair({ authUserId: "user_1", activeOrganizationId: "organization_1" }),
    BetterAuthProductSessionProjectionRepairError,
  );
});

function recordingReconciler(calls: unknown[]): HumanActorReconciliation {
  return {
    execute: async (input) => { calls.push(input); },
  };
}

function databaseWithSelectResults(results: unknown[][]): BackendDatabase {
  let selection = 0;
  return {
    select: (() => ({
      from: () => ({
        where: () => ({
          limit: async () => results[selection++] ?? [],
        }),
      }),
    })) as unknown as BackendDatabase["select"],
  } as BackendDatabase;
}
