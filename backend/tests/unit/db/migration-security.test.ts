import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const BASELINE_PATH = resolve(process.cwd(), "drizzle/0000_baseline.sql");
const COMPANY_DEVICES_PATH = resolve(process.cwd(), "drizzle/0001_company_devices.sql");
const PERSONAL_EXECUTORS_PATH = resolve(process.cwd(), "drizzle/0002_personal_executors.sql");
const PERSONAL_EXECUTOR_ONBOARDING_PATH = resolve(
  process.cwd(),
  "drizzle/0004_personal_executor_onboarding.sql",
);
const HOME_ACTOR_RECONCILIATION_BACKFILL_PATH = resolve(
  process.cwd(),
  "drizzle/0005_home_actor_reconciliation_backfill.sql",
);
const EXECUTOR_CUSTOM_API_AUTH_PATH = resolve(
  process.cwd(),
  "drizzle/0008_executor_custom_api_auth.sql",
);
const COMPANY_ASSETS_PATH = resolve(process.cwd(), "drizzle/0009_company_assets.sql");
const COMPANY_RUNTIME_RELEASE_RECONCILIATION_PATH = resolve(
  process.cwd(),
  "drizzle/0010_company_runtime_release_reconciliation.sql",
);
const COMPANY_RUNTIME_AUTOMATIC_RELEASE_PATH = resolve(
  process.cwd(),
  "drizzle/0013_company_runtime_automatic_release.sql",
);
const ROOM_TURN_MESSAGES_PATH = resolve(
  process.cwd(),
  "drizzle/0015_room_turn_messages.sql",
);
const MIXED_AGENT_ROOM_TRIGGER_POLICIES_PATH = resolve(
  process.cwd(),
  "drizzle/0020_mixed_agent_room_trigger_policies.sql",
);
const REMOVE_ROOM_FILE_PROJECTIONS_PATH = resolve(
  process.cwd(),
  "drizzle/0023_remove_room_file_projections.sql",
);
const EXECUTOR_MODEL_POLICIES_PATH = resolve(
  process.cwd(),
  "drizzle/0024_executor_model_policies.sql",
);

async function readBaseline(): Promise<string> {
  return readFile(BASELINE_PATH, "utf8");
}

test("fresh 0000 empty-database baseline never transforms product data", async () => {
  const migration = await readBaseline();
  assert.doesNotMatch(migration, /^\s*(?:delete|insert|truncate|update)\b/imu);
  assert.match(migration, /CREATE TABLE "companies"/u);
  assert.match(migration, /CREATE TABLE "company_onboarding_processes"/u);
  assert.match(migration, /CREATE TABLE "outbox_events"/u);
});

test("migration journal preserves 0000 first and uses monotonic incremental tags", async () => {
  const journal = JSON.parse(await readFile(
    resolve(process.cwd(), "drizzle/meta/_journal.json"),
    "utf8",
  )) as { entries?: Array<{ idx?: number; tag?: string }> };
  assert.ok((journal.entries?.length ?? 0) >= 1);
  assert.equal(journal.entries?.[0]?.idx, 0);
  assert.equal(journal.entries?.[0]?.tag, "0000_baseline");
  for (let index = 1; index < (journal.entries?.length ?? 0); index += 1) {
    assert.equal(journal.entries?.[index]?.idx, index);
  }
});

test("0020 expands both persisted Agent-Room trigger policy constraints", async () => {
  const migration = await readFile(MIXED_AGENT_ROOM_TRIGGER_POLICIES_PATH, "utf8");
  for (const constraint of [
    "agent_room_states_trigger_policy_check",
    "agent_room_executions_trigger_policy_check",
  ]) {
    assert.match(migration, new RegExp(`DROP CONSTRAINT "${constraint}"`, "u"));
    assert.match(migration, new RegExp(`ADD CONSTRAINT "${constraint}"`, "u"));
  }
  assert.match(migration, /'human_explicit_agent_auto'/u);
  assert.match(migration, /'agent_explicit_human_auto'/u);
  assert.doesNotMatch(migration, /^\s*(?:delete|insert|truncate|update)\b/imu);
});

test("0023 removes Room file projections and stale URL-bearing execution snapshots", async () => {
  const migration = await readFile(REMOVE_ROOM_FILE_PROJECTIONS_PATH, "utf8");
  assert.match(migration, /SET "company_file_inputs_json" = NULL/u);
  assert.match(migration, /DROP TABLE IF EXISTS "room_file_references"/u);
});

test("0024 requires every existing Executor assignment to finish model configuration", async () => {
  const migration = await readFile(EXECUTOR_MODEL_POLICIES_PATH, "utf8");
  assert.match(migration, /ADD COLUMN "allowed_models_json" jsonb DEFAULT '\[\]'::jsonb NOT NULL/u);
  assert.match(migration, /ADD COLUMN "configuration_revision" bigint DEFAULT 0 NOT NULL/u);
  assert.match(migration, /'configuration_required'/u);
  assert.match(migration, /"last_error_code" = 'EXECUTOR_CONFIGURATION_REQUIRED'/u);
  assert.doesNotMatch(migration, /credential|api_key|access_token|refresh_token/iu);
  assert.doesNotMatch(migration, /^\s*(?:delete|insert|truncate)\b/imu);
});

test("0001 Company Device migration upgrades 0000 safely without Call persistence", async () => {
  const migration = await readFile(COMPANY_DEVICES_PATH, "utf8");
  assert.match(migration, /CREATE TABLE "company_devices"/u);
  assert.match(migration, /FOREIGN KEY \("company_id"\) REFERENCES "public"\."companies"/u);
  assert.match(migration, /current_token_hash/u);
  assert.match(migration, /pending_token_hash/u);
  assert.match(migration, /company_devices_company_id_idx/u);
  assert.match(migration, /company_devices_active_company_idx/u);
  assert.doesNotMatch(migration, /^\s*(?:delete|insert|truncate|update)\b/imu);
  assert.doesNotMatch(migration, /CREATE TABLE "(?:calls|turns|audio|transcripts)"/iu);
});

test("0002 Personal Executor migration backfills every legacy runtime reference or fails before enforcing it", async () => {
  const migration = await readFile(PERSONAL_EXECUTORS_PATH, "utf8");
  assert.match(migration, /"assignment_version" bigint DEFAULT 1 NOT NULL/u);
  assert.match(migration, /"executor_id", "assignment_version", "created_at_ms"/u);
  assert.match(migration, /SELECT actor\."id", actor\."company_id", executor\."executor_id", 1,/u);
  assert.match(migration, /cannot migrate Room membership without a Company default Executor/u);
  assert.match(migration, /cannot migrate Room actor binding without a Company default Executor/u);
  assert.match(migration, /cannot migrate Home Agent without a Company default Executor/u);
  const failFast = migration.indexOf("cannot migrate Room membership");
  assert.ok(failFast > migration.indexOf('UPDATE "room_memberships"'));
  assert.ok(failFast > migration.indexOf('INSERT INTO "home_agent_executor_assignments"'));
  assert.ok(failFast < migration.indexOf('ALTER TABLE "room_memberships" ALTER COLUMN "executor_id" SET NOT NULL'));
});

test("0004 migrates legacy Company Executors in place without rewriting runtime references", async () => {
  const migration = await readFile(PERSONAL_EXECUTOR_ONBOARDING_PATH, "utf8");
  assert.match(migration, /WHERE "scope" = 'company'/u);
  assert.match(migration, /cannot migrate Company Executor without an active Company Owner/u);
  assert.match(migration, /SET "scope" = 'personal'/u);
  assert.match(migration, /"sharing_state" = 'company_shared'/u);
  assert.match(migration, /"is_default" = false/u);
  assert.match(migration, /ON CONFLICT \("human_actor_id"\) DO NOTHING/u);
  assert.doesNotMatch(migration, /UPDATE "home_agent_executor_assignments"/u);
  assert.doesNotMatch(migration, /UPDATE "room_memberships"/u);
  assert.doesNotMatch(migration, /UPDATE "room_actor_bindings"/u);
  assert.ok(
    migration.indexOf('SET "scope" = \'personal\'')
      < migration.indexOf('ADD CONSTRAINT "company_executors_scope_shape_check"'),
  );
});

test("0005 backfills only strict active Human/Home pairs and narrowly requeues their blocked Home assignment", async () => {
  const migration = await readFile(HOME_ACTOR_RECONCILIATION_BACKFILL_PATH, "utf8");
  assert.match(migration, /'actor\.human_reconciled\.v1'/u);
  assert.match(migration, /'event_home_actor_backfill_' \|\| md5/u);
  assert.match(migration, /human\."type" = 'human'/u);
  assert.match(migration, /human\."status" = 'active'/u);
  assert.match(migration, /home\."type" = 'agent'/u);
  assert.match(migration, /home\."status" = 'active'/u);
  assert.match(migration, /home\."home_human_actor_id" = human\."id"/u);
  assert.match(migration, /delivery\."consumer_name" = 'execution\.executor-reconfiguration'/u);
  assert.match(migration, /delivery\."status" = 'dead_letter'/u);
  assert.match(migration, /delivery\."last_error_code" = 'EXECUTOR_RECONFIGURATION_UNAVAILABLE'/u);
  assert.match(migration, /failed_event\."payload_json"->>'cause' = 'home_assignment_changed'/u);
  assert.match(migration, /assignment\."executor_id" = failed_event\."payload_json"->>'executor_id'/u);
  assert.match(migration, /"status" = 'pending'/u);
  assert.match(migration, /"attempt" = 0/u);
  assert.match(migration, /ON CONFLICT \("event_id"\) DO NOTHING/u);
  assert.doesNotMatch(migration, /DELETE FROM/iu);
});

test("0008 backfills existing Executors as ChatGPT and persists only custom endpoint hosts", async () => {
  const migration = await readFile(EXECUTOR_CUSTOM_API_AUTH_PATH, "utf8");
  assert.match(migration, /"authorization_method" varchar\(32\) DEFAULT 'chatgpt' NOT NULL/u);
  assert.match(migration, /"endpoint_host" varchar\(512\)/u);
  assert.match(migration, /IN \('chatgpt', 'custom_api_key'\)/u);
  assert.match(migration, /"authorization_method" = 'chatgpt' AND "endpoint_host" IS NULL/u);
  assert.match(migration, /"authorization_method" = 'custom_api_key'/u);
  assert.match(migration, /"account_id" IS NULL/u);
  assert.match(migration, /"plan_type" IS NULL/u);
  assert.doesNotMatch(migration, /"(?:api_key|base_url)"/iu);
});

test("0009 introduces Company asset metadata without credential or system asset rows", async () => {
  const migration = await readFile(COMPANY_ASSETS_PATH, "utf8");
  assert.match(migration, /CREATE TABLE "company_assets"/u);
  assert.match(migration, /CREATE TABLE "company_asset_drafts"/u);
  assert.match(migration, /CREATE TABLE "company_asset_versions"/u);
  assert.match(migration, /CREATE TABLE "company_asset_version_credentials"/u);
  assert.match(migration, /company_asset_versions_company_kind_slug_version_unique/u);
  assert.match(migration, /company_assets_reserved_identity_check/u);
  assert.match(migration, /company_asset_drafts_reserved_identity_check/u);
  assert.match(
    migration,
    /FOREIGN KEY \("company_id","asset_id"\) REFERENCES "public"\."company_assets"\("company_id","id"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("company_id","id","current_version_id"\)[\s\S]*REFERENCES "public"\."company_asset_versions"\("company_id","asset_id","id"\)/u,
  );
  assert.match(migration, /company_asset_receipts_lease_check/u);
  const immutableVersions = migration.slice(
    migration.indexOf('CREATE TABLE "company_asset_versions"'),
    migration.indexOf('CREATE TABLE "company_asset_version_credentials"'),
  );
  assert.doesNotMatch(immutableVersions, /credential_operation_id/u);
  assert.match(
    migration,
    /company_asset_version_credentials_version_fk[\s\S]*ON DELETE cascade/u,
  );
  assert.match(
    migration,
    /"status" = 'pending' and "lease_owner" is not null and "lease_expires_at_ms" is not null and "completed_at_ms" is null/u,
  );
  assert.match(
    migration,
    /"status" in \('completed', 'failed'\) and "lease_owner" is null and "lease_expires_at_ms" is null and "completed_at_ms" is not null/u,
  );
  assert.doesNotMatch(migration, /bearer_token|access_token|refresh_token|credential_value/iu);
  assert.doesNotMatch(migration, /^\s*(?:delete|insert|truncate|update)\b/imu);
  assert.doesNotMatch(migration, /values\s*\([^)]*fields-core/iu);
});

test("0010 adds only durable Runtime release operation and member target projections", async () => {
  const migration = await readFile(COMPANY_RUNTIME_RELEASE_RECONCILIATION_PATH, "utf8");
  assert.match(migration, /ADD COLUMN "release_id" varchar\(128\)/u);
  assert.match(migration, /ADD COLUMN "runtime_image" varchar\(512\)/u);
  assert.match(migration, /company_runtime_operations_release_unique/u);
  assert.match(migration, /CREATE TABLE "company_runtime_release_members"/u);
  assert.match(migration, /company_runtime_release_members_operation_fk/u);
  assert.doesNotMatch(migration, /^\s*(?:delete|insert|truncate|update)\b/imu);
  assert.doesNotMatch(migration, /credential|bearer|token/iu);
});

test("0013 permits superseded automatic releases and repeated digest rollbacks", async () => {
  const migration = await readFile(COMPANY_RUNTIME_AUTOMATIC_RELEASE_PATH, "utf8");
  assert.match(migration, /DROP INDEX IF EXISTS "company_runtime_operations_release_unique"/u);
  assert.match(migration, /'superseded'/u);
  assert.doesNotMatch(migration, /^\s*(?:delete|insert|truncate|update)\b/imu);
  assert.doesNotMatch(migration, /credential|bearer|token/iu);
});

test("0015 preserves Room history while adding revisioned Agent Turn versions", async () => {
  const migration = await readFile(ROOM_TURN_MESSAGES_PATH, "utf8");
  assert.doesNotMatch(migration, /DELETE FROM "room_messages"/u);
  assert.doesNotMatch(migration, /DELETE FROM "agent_room_executions"/u);
  assert.match(migration, /"next_message_event_sequence" bigint NOT NULL DEFAULT 1/u);
  assert.match(migration, /ADD COLUMN "event_sequence" bigint/u);
  assert.match(migration, /ALTER COLUMN "event_sequence" SET NOT NULL/u);
  assert.match(migration, /ADD COLUMN "revision" bigint NOT NULL DEFAULT 1/u);
  assert.match(migration, /room_messages_room_event_sequence_unique/u);
  assert.match(migration, /room_message_revisions/u);
  assert.match(migration, /room_agent_reply_version_groups/u);
  assert.match(migration, /room_agent_reply_selections/u);
  assert.match(migration, /room_messages_version_group_message_unique/u);
  assert.match(
    migration,
    /FOREIGN KEY \("version_group_id", "selected_message_id"\)[\s\S]*REFERENCES "room_messages" \("version_group_id", "message_id"\)/u,
  );
  assert.match(migration, /room_agent_reply_selections_member_fk/u);
  assert.match(migration, /room_message_mutation_receipts/u);
  assert.match(migration, /"turn_message_id" varchar\(128\)/u);
  assert.match(migration, /DROP INDEX "room_interactions_message_unique"/u);
  assert.match(migration, /CREATE INDEX "room_interactions_message_idx"/u);
  assert.doesNotMatch(migration, /credential|bearer|token/iu);
});

test("fresh baseline keeps the approved Human Home Agent shape and creates referenced keys first", async () => {
  const migration = await readBaseline();
  assert.match(migration, /"home_human_actor_id" varchar\(128\)/u);
  assert.match(migration, /CREATE UNIQUE INDEX "actors_home_human_actor_id_unique"/u);
  assert.match(migration, /FOREIGN KEY \("company_id","home_human_actor_id"\)/u);
  assert.match(migration, /"type" = 'agent'/u);
  assert.match(migration, /"auth_user_id" is null/u);
  assert.match(migration, /"company_role" = 'member'/u);
  assert.ok(
    migration.indexOf('CREATE UNIQUE INDEX "actors_company_actor_unique"')
      < migration.indexOf('ADD CONSTRAINT "actors_home_human_actor_fk"'),
    "The referenced composite unique index must exist before PostgreSQL creates the self-FK.",
  );
  for (const [indexName, constraintName] of [
    ["company_executors_company_executor_unique", "executor_auth_attempts_company_executor_fk"],
    ["company_home_workspaces_company_home_unique", "company_home_instances_workspace_fk"],
    ["company_home_operations_identity_unique", "company_home_instances_source_operation_fk"],
    ["company_home_instances_identity_unique", "company_home_leases_runtime_identity_fk"],
  ]) {
    assert.ok(
      migration.indexOf(`CREATE UNIQUE INDEX "${indexName}"`)
        < migration.indexOf(`ADD CONSTRAINT "${constraintName}"`),
      `${indexName} must exist before ${constraintName} is created.`,
    );
  }
});

test("fresh baseline creates the durable eventing tables with safe error-code fields", async () => {
  const migration = await readBaseline();
  const eventing = migration.slice(
    migration.indexOf('CREATE TABLE "event_inbox"'),
    migration.indexOf('CREATE TABLE "room_memberships"'),
  );
  assert.match(migration, /"membership_version" bigint DEFAULT 1 NOT NULL/u);
  assert.match(eventing, /"sequence" bigserial NOT NULL/u);
  assert.match(eventing, /PRIMARY KEY\("event_id","consumer_name"\)/u);
  assert.match(eventing, /'pending', 'claimed', 'succeeded', 'dead_letter'/u);
  assert.match(eventing, /"last_error_code" varchar\(128\)/u);
  assert.doesNotMatch(eventing, /"last_error"/u);
});
