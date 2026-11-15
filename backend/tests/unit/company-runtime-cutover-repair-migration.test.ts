import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0007_company_runtime_cutover_repair.sql", import.meta.url),
  "utf8",
);

test("cutover repair rejects ambiguous active Company Runtime state", () => {
  assert.match(migration, /active Company with a partial Runtime topology/u);
  assert.match(migration, /requires exactly one active Human Owner per Company/u);
  assert.match(migration, /count\(owner\."id"\) <> 1/u);
  assert.match(migration, /process\."stage" = 'ready'/u);
  assert.match(migration, /workspace\."status" = 'ready'/u);
  assert.match(migration, /lease\."status" = 'ready'/u);
  assert.match(migration, /instance\."observed_state" = 'ready'/u);
});

test("cutover repair creates one controller-owned provision operation without an outbox event", () => {
  assert.match(migration, /INSERT INTO "company_onboarding_processes"/u);
  assert.match(migration, /INSERT INTO "company_runtime_workspaces"/u);
  assert.match(migration, /INSERT INTO "company_runtime_operations"/u);
  assert.match(migration, /'creatingRuntime'/u);
  assert.match(migration, /'provision'/u);
  assert.match(migration, /'pending'/u);
  assert.match(migration, /"status" = 'provisioning'/u);
  assert.doesNotMatch(migration, /outbox/u);
});

test("cutover repair targets only active Companies with no Runtime topology", () => {
  const targetStart = migration.indexOf('CREATE TEMPORARY TABLE "_company_runtime_cutover_repair_targets"');
  assert.ok(targetStart >= 0);
  const targetQuery = migration.slice(targetStart, migration.indexOf("INSERT INTO", targetStart));
  assert.match(targetQuery, /company\."status" = 'active'/u);
  for (const table of [
    "company_onboarding_processes",
    "company_runtime_workspaces",
    "company_runtime_operations",
    "company_runtime_instances",
    "company_runtime_leases",
  ]) {
    assert.match(targetQuery, new RegExp(`NOT EXISTS \\([\\s\\S]*"${table}"`, "u"));
  }
});
