import assert from "node:assert/strict";
import test from "node:test";

import type { CompanyRuntimePublicGateway } from "../../src/application/execution/ports/index.js";
import type { BackendDatabase } from "../../src/infrastructure/persistence/postgres/database-service.js";
import { PostgresMemberMemoryApplication } from "../../src/infrastructure/persistence/postgres/repositories/company/member-memory-repository.js";

test("Member Memory applies Human Home preference and records Runtime completion", async () => {
  let row = {
    companyId: "company-1",
    memberId: "human-1",
    enabled: true,
    appliedEnabled: true,
    status: "ready",
    errorCode: null as string | null,
    operationId: null as string | null,
    revision: 0,
    updatedAtMs: 100,
  };
  const db = {
    execute: async () => ({ rows: [{ id: "human-1" }] }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [row] }) }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          row = {
            ...row,
            ...values,
            revision: "revision" in values ? row.revision + 1 : row.revision,
          } as typeof row;
          return { returning: async () => [row] };
        },
      }),
    }),
  } as unknown as BackendDatabase;
  type AppliedMemory = { memberId: string; operationId: string; enabled: boolean; previousEnabled: boolean };
  const applied: AppliedMemory[] = [];
  const runtime = {
    memberMemoryApply: async (_companyId: string, input: AppliedMemory) => {
      applied.push(input);
      return { accepted: true as const };
    },
  } as unknown as CompanyRuntimePublicGateway;
  const application = new PostgresMemberMemoryApplication(db, runtime, () => 200);

  const applying = await application.update({
    companyId: "company-1",
    memberId: "human-1",
    enabled: false,
    expectedRevision: 0,
  });
  assert.equal(applying.enabled, false);
  assert.equal(applying.applied_enabled, true);
  assert.equal(applying.status, "applying");
  assert.equal(applied[0]?.memberId, "human-1");
  assert.equal(applied[0]?.enabled, false);
  assert.equal(applied[0]?.previousEnabled, true);

  await application.complete({
    companyId: "company-1",
    memberId: "human-1",
    operationId: applied[0]!.operationId,
    appliedEnabled: false,
    status: "ready",
    errorCode: null,
    completedAtMs: 250,
  });
  assert.equal(row.appliedEnabled, false);
  assert.equal(row.status, "ready");
  assert.equal(row.operationId, null);
});

test("Member Memory is enabled by default", async () => {
  const row = {
    companyId: "company-1",
    memberId: "human-1",
    enabled: true,
    appliedEnabled: true,
    status: "ready",
    errorCode: null,
    operationId: null,
    revision: 0,
    updatedAtMs: 100,
  };
  const db = {
    execute: async () => ({ rows: [{ id: "human-1" }] }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
  } as unknown as BackendDatabase;
  const application = new PostgresMemberMemoryApplication(
    db,
    {} as CompanyRuntimePublicGateway,
    () => 100,
  );
  assert.deepEqual(await application.profile("company-1", "human-1"), {
    enabled: true,
    applied_enabled: true,
    status: "ready",
    error_code: null,
    revision: 0,
  });
});
