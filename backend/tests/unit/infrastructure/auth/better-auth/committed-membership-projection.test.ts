import assert from "node:assert/strict";
import test from "node:test";

import type {
  ReconcileHumanActorUseCase,
  ReconcileRemovedHumanUseCase,
} from "../../../../../src/application/actor/commands/index.js";
import { ApplicationError } from "../../../../../src/application/platform/errors.js";
import type { BackendDatabase } from "../../../../../src/infrastructure/persistence/postgres/database-service.js";

import {
  BetterAuthCommittedMembershipProjection,
  BetterAuthCommittedMembershipProjectionError,
  COMMITTED_MEMBERSHIP_PROJECTION_CONFLICT_CODE,
  COMMITTED_MEMBERSHIP_PROJECTION_INPUT_INVALID_CODE,
} from "../../../../../src/infrastructure/auth/better-auth/committed-membership-projection.js";

test("committed invitation acceptance rereads user, sole membership, and Company before active reconciliation", async () => {
  const active = new RecordingActiveReconciliation();
  const removed = new RecordingRemovedReconciliation();
  const projection = new BetterAuthCommittedMembershipProjection(
    databaseWithSelectResults([
      [{ authUserId: "user_one", displayName: "Ada Lovelace" }],
      [{ organizationId: "organization_one", role: "member" }],
      [{ companyId: "company_one", organizationId: "organization_one" }],
    ]),
    active,
    removed,
  );

  const result = await projection.reconcileAcceptedMembership({
    authUserId: "user_one",
    organizationId: "organization_one",
  });

  assert.equal(result, undefined);
  assert.deepEqual(active.calls, [{
    authUserId: "user_one",
    companyId: "company_one",
    displayName: "Ada Lovelace",
    companyRole: "member",
  }]);
  assert.deepEqual(removed.calls, []);
});

test("a stale accepted hook cannot activate an Actor after authoritative membership changed", async () => {
  const active = new RecordingActiveReconciliation();
  const removed = new RecordingRemovedReconciliation();
  const projection = new BetterAuthCommittedMembershipProjection(
    databaseWithSelectResults([
      [{ authUserId: "user_one", displayName: "Ada Lovelace" }],
      [{ organizationId: "organization_other", role: "member" }],
      [{ companyId: "company_one", organizationId: "organization_one" }],
    ]),
    active,
    removed,
  );

  await projection.reconcileAcceptedMembership({
    authUserId: "user_one",
    organizationId: "organization_one",
  });

  assert.deepEqual(active.calls, []);
  assert.deepEqual(removed.calls, []);
});

test("committed removal rereads the absent target membership and invokes only removed-Human reconciliation", async () => {
  const active = new RecordingActiveReconciliation();
  const removed = new RecordingRemovedReconciliation();
  const projection = new BetterAuthCommittedMembershipProjection(
    databaseWithSelectResults([
      [{ authUserId: "user_one", displayName: "Ada Lovelace" }],
      [],
      [{ companyId: "company_one", organizationId: "organization_one" }],
    ]),
    active,
    removed,
  );

  await projection.reconcileRemovedMembership({
    authUserId: "user_one",
    organizationId: "organization_one",
  });

  assert.deepEqual(active.calls, []);
  assert.deepEqual(removed.calls, [{ authUserId: "user_one", companyId: "company_one" }]);
});

test("a removal hook that still sees the target membership is a safe no-op", async () => {
  const active = new RecordingActiveReconciliation();
  const removed = new RecordingRemovedReconciliation();
  const projection = new BetterAuthCommittedMembershipProjection(
    databaseWithSelectResults([
      [{ authUserId: "user_one", displayName: "Ada Lovelace" }],
      [{ organizationId: "organization_one", role: "member" }],
      [{ companyId: "company_one", organizationId: "organization_one" }],
    ]),
    active,
    removed,
  );

  await projection.reconcileRemovedMembership({
    authUserId: "user_one",
    organizationId: "organization_one",
  });

  assert.deepEqual(active.calls, []);
  assert.deepEqual(removed.calls, []);
});

test("ambiguous authority and malformed hook input fail with stable nonretryable ApplicationErrors", async () => {
  const active = new RecordingActiveReconciliation();
  const removed = new RecordingRemovedReconciliation();
  const projection = new BetterAuthCommittedMembershipProjection(
    databaseWithSelectResults([
      [{ authUserId: "user_one", displayName: "Ada Lovelace" }],
      [
        { organizationId: "organization_one", role: "member" },
        { organizationId: "organization_two", role: "member" },
      ],
      [{ companyId: "company_one", organizationId: "organization_one" }],
    ]),
    active,
    removed,
  );

  await assert.rejects(
    projection.reconcileAcceptedMembership({ authUserId: "user_one", organizationId: "organization_one" }),
    applicationError(COMMITTED_MEMBERSHIP_PROJECTION_CONFLICT_CODE, false),
  );
  await assert.rejects(
    projection.reconcileRemovedMembership({ authUserId: "user\ninvalid", organizationId: "organization_one" }),
    applicationError(COMMITTED_MEMBERSHIP_PROJECTION_INPUT_INVALID_CODE, false),
  );
});

test("database failures never expose provider/database causes", async () => {
  const secret = "postgres://auth-user:never-expose@example.internal/fields";
  const projection = new BetterAuthCommittedMembershipProjection(
    databaseWithSelectFailure(new Error(secret)),
    new RecordingActiveReconciliation(),
    new RecordingRemovedReconciliation(),
  );

  await assert.rejects(
    projection.reconcileAcceptedMembership({ authUserId: "user_one", organizationId: "organization_one" }),
    (error: unknown) => {
      assert.ok(error instanceof BetterAuthCommittedMembershipProjectionError);
      assert.equal(error.message.includes(secret), false);
      assert.equal("cause" in error, false);
      return true;
    },
  );
});

class RecordingActiveReconciliation implements ReconcileHumanActorUseCase {
  readonly calls: Array<{
    authUserId: string;
    companyId: string;
    displayName: string;
    companyRole: "owner" | "member";
  }> = [];

  async execute(input: {
    authUserId: string;
    companyId: string;
    displayName: string;
    companyRole: "owner" | "member";
  }): Promise<never> {
    this.calls.push(input);
    return undefined as never;
  }
}

class RecordingRemovedReconciliation implements ReconcileRemovedHumanUseCase {
  readonly calls: Array<{ authUserId: string; companyId: string }> = [];

  async execute(input: { authUserId: string; companyId: string }): Promise<null> {
    this.calls.push(input);
    return null;
  }
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

function databaseWithSelectFailure(error: Error): BackendDatabase {
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

function applicationError(code: string, retryable: boolean): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    assert.equal("cause" in error, false);
    return true;
  };
}
