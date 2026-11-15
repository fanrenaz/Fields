ALTER TABLE "company_executors"
  ADD COLUMN "executor_type" varchar(32) DEFAULT 'codex' NOT NULL,
  ADD COLUMN "configuration_status" varchar(32) DEFAULT 'pending' NOT NULL,
  ADD COLUMN "configuration_revision" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "allowed_models_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN "allowed_reasoning_efforts_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN "default_model" varchar(512),
  ADD COLUMN "default_reasoning_effort" varchar(64),
  ADD COLUMN "catalog_checked_at_ms" bigint,
  ADD COLUMN "configuration_updated_at_ms" bigint;--> statement-breakpoint

ALTER TABLE "company_executors"
  ADD CONSTRAINT "company_executors_type_check"
    CHECK ("executor_type" = 'codex'),
  ADD CONSTRAINT "company_executors_configuration_status_check"
    CHECK ("configuration_status" IN ('pending', 'validating', 'ready', 'invalid')),
  ADD CONSTRAINT "company_executors_configuration_revision_check"
    CHECK ("configuration_revision" >= 0);--> statement-breakpoint

ALTER TABLE "member_executor_assignments"
  DROP CONSTRAINT "member_executor_assignments_state_check";--> statement-breakpoint

ALTER TABLE "member_executor_assignments"
  ADD CONSTRAINT "member_executor_assignments_state_check"
    CHECK ("state" IN ('ready', 'switching', 'configuration_required', 'auth_required', 'failed'));--> statement-breakpoint

UPDATE "member_executor_assignments" AS "assignment"
SET
  "state" = 'configuration_required',
  "pending_executor_id" = NULL,
  "previous_executor_id" = NULL,
  "switch_operation_id" = NULL,
  "last_error_code" = 'EXECUTOR_CONFIGURATION_REQUIRED',
  "last_error_retryable" = false,
  "updated_at_ms" = GREATEST(
    "assignment"."updated_at_ms",
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
FROM "company_executors" AS "executor"
WHERE "assignment"."company_id" = "executor"."company_id"
  AND "assignment"."executor_id" = "executor"."executor_id";--> statement-breakpoint
