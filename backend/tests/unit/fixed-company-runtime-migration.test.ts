import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../drizzle/0034_fixed_company_runtime.sql", import.meta.url);

test("fixed Runtime migration preserves status and removes orchestration tables", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /CREATE TABLE "company_runtime_status"/u);
  assert.match(migration, /INSERT INTO "company_runtime_status"/u);
  assert.match(migration, /runtime\.member-runtime-reactivation/u);
  for (const table of [
    "company_runtime_release_members",
    "company_runtime_presences",
    "company_runtime_leases",
    "company_runtime_instances",
    "company_runtime_operations",
    "company_runtime_workspaces",
  ]) {
    assert.match(migration, new RegExp(`DROP TABLE "${table}"`, "u"));
  }
  assert.doesNotMatch(migration, /DROP TABLE "(?:companies|actors|company_executors|member_executor_assignments)"/u);
});
