import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../../drizzle/0014_restore_codex_executor_schema.sql",
  import.meta.url,
);

test("0014 restores Executor rows and assignments after the OpenCodex migration", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /WHEN "status" IN \('pending_model', 'validating'\) THEN\s+CASE WHEN "credential_version" > 0 THEN 'connected' ELSE 'pending_auth' END/u,
  );
  assert.match(migration, /WHEN "status" = 'available' THEN 'connected'/u);
  assert.match(migration, /WHEN "status" = 'deleting' THEN 'revoked'/u);
  assert.match(migration, /WHEN "authorization_method" = 'api_key' THEN 'custom_api_key'/u);
  assert.match(migration, /WHEN "authorization_method" = 'oauth' THEN 'chatgpt'/u);
  assert.match(migration, /"last_error_code" = 'EXECUTOR_MODEL_SELECTION_REQUIRED'/u);
  assert.match(migration, /WHEN "executor"\."status" = 'connected' THEN 'ready'/u);
});

test("0014 removes only OpenCodex projections and restores current constraints", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  for (const column of [
    "provider_id",
    "provider_display_name",
    "protocol",
    "model_id",
    "model_display_name",
    "model_capabilities_json",
    "catalog_state",
    "account_pool_summary_json",
    "sidecar_summary_json",
    "provider_base_url",
    "runtime_provisioned_at_ms",
    "credential_cleanup_pending",
    "credential_reconnect_pending",
  ]) {
    assert.match(migration, new RegExp(`DROP COLUMN IF EXISTS "${column}"`, "u"));
  }
  assert.match(
    migration,
    /CHECK \("authorization_method" IN \('chatgpt', 'custom_api_key'\)\)/u,
  );
  assert.match(
    migration,
    /CHECK \("status" IN \('pending_auth', 'connected', 'expired', 'revoked', 'failed'\)\)/u,
  );
  assert.match(migration, /company_executors_company_account_unique/u);
});
