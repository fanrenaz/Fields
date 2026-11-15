import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../drizzle/0006_company_runtime_cutover.sql", import.meta.url);
const previousSnapshotUrl = new URL("../../drizzle/meta/0004_snapshot.json", import.meta.url);
const cutoverSnapshotUrl = new URL("../../drizzle/meta/0006_snapshot.json", import.meta.url);
const backendProcessMigrationUrl = new URL(
  "../../drizzle/0033_backend_runtime_process.sql",
  import.meta.url,
);

type SnapshotForeignKey = {
  columnsFrom: string[];
  columnsTo: string[];
  tableFrom: string;
  tableTo: string;
};

type SnapshotTable = {
  foreignKeys: Record<string, SnapshotForeignKey>;
  indexes: Record<string, unknown>;
  checkConstraints: Record<string, unknown>;
};

type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<string, SnapshotTable>;
};

const cutoverTables = [
  "company_onboarding_processes",
  "company_runtime_workspaces",
  "company_runtime_operations",
  "company_runtime_instances",
  "company_runtime_leases",
  "agent_member_cleanup_operations",
  "company_runtime_presences",
  "company_executors",
  "member_executor_assignments",
  "executor_auth_attempts",
  "room_messages",
  "agent_room_states",
  "agent_room_cascades",
  "agent_room_executions",
  "agent_room_execution_messages",
  "agent_room_activity_receipts",
  "agent_room_activity_snapshots",
  "room_interactions",
  "room_interaction_responses",
] as const;

test("cutover migration creates the single Runtime model and destroys retired fleets", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  for (const table of [
    "company_runtime_workspaces",
    "company_runtime_operations",
    "company_runtime_instances",
    "company_runtime_leases",
    "company_executors",
    "member_executor_assignments",
    "room_messages",
    "agent_room_states",
    "agent_room_executions",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE \"${table}\"`, "u"));
  }
  for (const retired of [
    "company_home_workspaces",
    "company_home_instances",
    "room_sandbox_workspaces",
    "room_sandbox_instances",
    "room_actor_bindings",
    "home_agent_executor_assignments",
  ]) {
    assert.match(migration, new RegExp(`DROP TABLE IF EXISTS \"${retired}\"`, "u"));
  }
  assert.match(migration, /DROP COLUMN IF EXISTS "home_human_actor_id"/u);
  assert.match(migration, /DROP COLUMN IF EXISTS "executor_id"/u);
});

test("cutover snapshot is the truthful post-0006 schema baseline", async () => {
  const previous = JSON.parse(await readFile(previousSnapshotUrl, "utf8")) as Snapshot;
  const snapshot = JSON.parse(await readFile(cutoverSnapshotUrl, "utf8")) as Snapshot;

  assert.equal(snapshot.prevId, previous.id);
  assert.equal(Object.keys(snapshot.tables).length, 34);

  for (const table of cutoverTables) {
    assert.ok(snapshot.tables[`public.${table}`], `missing cutover table ${table}`);
  }
  for (const retired of [
    "company_home_workspaces",
    "company_home_instances",
    "room_sandbox_workspaces",
    "room_sandbox_instances",
    "room_actor_bindings",
    "home_agent_executor_assignments",
  ]) {
    assert.equal(snapshot.tables[`public.${retired}`], undefined, `retained retired table ${retired}`);
  }

  const cleanup = snapshot.tables["public.agent_member_cleanup_operations"];
  assert.ok(cleanup);
  assert.deepEqual(Object.keys(cleanup.foreignKeys), [
    "agent_member_cleanup_operations_actor_fk",
  ]);
  assert.deepEqual(cleanup.foreignKeys.agent_member_cleanup_operations_actor_fk, {
    name: "agent_member_cleanup_operations_actor_fk",
    tableFrom: "agent_member_cleanup_operations",
    tableTo: "actors",
    columnsFrom: ["company_id", "member_id"],
    columnsTo: ["company_id", "id"],
    onDelete: "restrict",
    onUpdate: "no action",
  });
});

test("cutover SQL constraint and index identities match the snapshot", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const snapshot = JSON.parse(await readFile(cutoverSnapshotUrl, "utf8")) as Snapshot;
  const tables = cutoverTables.map((table) => {
    const entry = snapshot.tables[`public.${table}`];
    assert.ok(entry, `missing cutover table ${table}`);
    return entry;
  });

  const snapshotForeignKeys = tables.flatMap((table) => Object.keys(table.foreignKeys)).sort();
  const sqlForeignKeys = matches(migration, /CONSTRAINT "([^"]+_fk)"/gu).sort();
  assert.deepEqual(sqlForeignKeys, snapshotForeignKeys);

  const snapshotIndexes = [
    ...tables.flatMap((table) => Object.keys(table.indexes)),
    "rooms_room_company_unique",
  ].sort();
  const sqlIndexes = matches(
    migration,
    /CREATE (?:UNIQUE )?INDEX "([^"]+)"/gu,
  ).sort();
  assert.deepEqual(sqlIndexes, snapshotIndexes);

  const snapshotChecks = [
    ...tables.flatMap((table) => Object.keys(table.checkConstraints)),
    "rooms_next_message_sequence_check",
  ].sort();
  const sqlChecks = matches(migration, /CONSTRAINT "([^"]+_check)"/gu).sort();
  assert.deepEqual(sqlChecks, snapshotChecks);
});

test("Backend process migration retargets only the active Runtime deployment metadata", async () => {
  const migration = await readFile(backendProcessMigrationUrl, "utf8");
  assert.match(migration, /UPDATE "company_runtime_instances" instance/u);
  assert.match(migration, /"runtime_url" = 'http:\/\/backend:4110'/u);
  assert.match(migration, /"container_name" = 'backend'/u);
  assert.match(migration, /FROM "company_runtime_leases" lease/u);
  assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/iu);
  assert.doesNotMatch(migration, /(?:\/workdir|members\/|executors\/)/u);
});

function matches(input: string, expression: RegExp): string[] {
  return [...input.matchAll(expression)].map((match) => {
    assert.ok(match[1]);
    return match[1];
  });
}
