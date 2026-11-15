ALTER TABLE "company_executors"
  DROP CONSTRAINT IF EXISTS "company_executors_authorization_method_check",
  DROP CONSTRAINT IF EXISTS "company_executors_authorization_projection_check",
  DROP CONSTRAINT IF EXISTS "company_executors_status_check",
  DROP CONSTRAINT IF EXISTS "company_executors_protocol_check",
  DROP CONSTRAINT IF EXISTS "company_executors_model_shape_check",
  DROP CONSTRAINT IF EXISTS "company_executors_catalog_state_check";--> statement-breakpoint

UPDATE "company_executors"
SET
  "status" = CASE
    WHEN "authorization_method" = 'oauth' THEN 'pending_auth'
    WHEN "status" = 'available' THEN 'connected'
    WHEN "status" IN ('pending_model', 'validating') THEN
      CASE WHEN "credential_version" > 0 THEN 'connected' ELSE 'pending_auth' END
    WHEN "status" = 'deleting' THEN 'revoked'
    ELSE "status"
  END,
  "authorization_method" = CASE
    WHEN "authorization_method" = 'api_key' THEN 'custom_api_key'
    WHEN "authorization_method" = 'oauth' THEN 'chatgpt'
    ELSE "authorization_method"
  END,
  "endpoint_host" = CASE
    WHEN "authorization_method" = 'oauth' THEN NULL
    ELSE "endpoint_host"
  END,
  "updated_at_ms" = GREATEST(
    "updated_at_ms",
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
WHERE
  "authorization_method" IN ('api_key', 'oauth')
  OR "status" IN ('pending_model', 'validating', 'available', 'deleting');--> statement-breakpoint

UPDATE "member_executor_assignments" AS "assignment"
SET
  "state" = CASE
    WHEN "executor"."status" = 'connected' THEN 'ready'
    ELSE 'auth_required'
  END,
  "last_error_code" = NULL,
  "last_error_retryable" = NULL,
  "updated_at_ms" = GREATEST(
    "assignment"."updated_at_ms",
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
FROM "company_executors" AS "executor"
WHERE
  "assignment"."company_id" = "executor"."company_id"
  AND "assignment"."executor_id" = "executor"."executor_id"
  AND "assignment"."last_error_code" = 'EXECUTOR_MODEL_SELECTION_REQUIRED';--> statement-breakpoint

ALTER TABLE "company_executors"
  DROP COLUMN IF EXISTS "provider_id",
  DROP COLUMN IF EXISTS "provider_display_name",
  DROP COLUMN IF EXISTS "protocol",
  DROP COLUMN IF EXISTS "model_id",
  DROP COLUMN IF EXISTS "model_display_name",
  DROP COLUMN IF EXISTS "model_capabilities_json",
  DROP COLUMN IF EXISTS "catalog_state",
  DROP COLUMN IF EXISTS "account_pool_summary_json",
  DROP COLUMN IF EXISTS "sidecar_summary_json",
  DROP COLUMN IF EXISTS "provider_base_url",
  DROP COLUMN IF EXISTS "runtime_provisioned_at_ms",
  DROP COLUMN IF EXISTS "credential_cleanup_pending",
  DROP COLUMN IF EXISTS "credential_reconnect_pending";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "company_executors_company_account_unique"
  ON "company_executors" ("company_id", "account_id")
  WHERE "account_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "company_executors"
  ADD CONSTRAINT "company_executors_authorization_method_check"
    CHECK ("authorization_method" IN ('chatgpt', 'custom_api_key')),
  ADD CONSTRAINT "company_executors_authorization_projection_check"
    CHECK (
      ("authorization_method" = 'chatgpt' AND "endpoint_host" IS NULL)
      OR (
        "authorization_method" = 'custom_api_key'
        AND "account_id" IS NULL
        AND "plan_type" IS NULL
      )
    ),
  ADD CONSTRAINT "company_executors_status_check"
    CHECK ("status" IN ('pending_auth', 'connected', 'expired', 'revoked', 'failed'));
