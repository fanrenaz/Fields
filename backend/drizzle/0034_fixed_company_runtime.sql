CREATE TABLE "company_runtime_status" (
  "company_id" varchar(128) PRIMARY KEY NOT NULL,
  "state" varchar(32) DEFAULT 'starting' NOT NULL,
  "active_member_server_count" bigint DEFAULT 0 NOT NULL,
  "active_execution_count" bigint DEFAULT 0 NOT NULL,
  "status_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_error_code" varchar(128),
  "last_error_retryable" boolean,
  "observed_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_runtime_status_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade,
  CONSTRAINT "company_runtime_status_state_check"
    CHECK ("state" in ('starting', 'ready', 'degraded', 'stopping', 'failed')),
  CONSTRAINT "company_runtime_status_counts_check"
    CHECK ("active_member_server_count" >= 0 and "active_execution_count" >= 0)
);
--> statement-breakpoint
INSERT INTO "company_runtime_status" (
  "company_id", "state", "active_member_server_count", "active_execution_count",
  "status_json", "last_error_code", "last_error_retryable", "observed_at_ms", "updated_at_ms"
)
SELECT
  company."id",
  CASE
    WHEN instance."observed_state" = 'failed' THEN 'failed'
    WHEN presence."status_json"->>'state' IN ('starting', 'ready', 'degraded', 'stopping', 'failed')
      THEN presence."status_json"->>'state'
    WHEN instance."observed_state" IN ('starting', 'ready', 'stopping', 'failed')
      THEN instance."observed_state"
    ELSE 'starting'
  END,
  COALESCE(presence."active_member_server_count", 0),
  COALESCE(presence."active_execution_count", 0),
  COALESCE(presence."status_json", '{"member_app_servers":[]}'::jsonb),
  COALESCE(instance."last_error_code", workspace."last_error_code"),
  COALESCE(instance."last_error_retryable", workspace."last_error_retryable"),
  COALESCE(presence."observed_at_ms", lease."last_heartbeat_at_ms", instance."last_heartbeat_at_ms", company."updated_at_ms"),
  GREATEST(company."updated_at_ms", workspace."updated_at_ms", instance."updated_at_ms", lease."updated_at_ms")
FROM "companies" company
LEFT JOIN "company_runtime_workspaces" workspace ON workspace."company_id" = company."id"
LEFT JOIN "company_runtime_leases" lease ON lease."company_id" = company."id"
LEFT JOIN "company_runtime_instances" instance
  ON instance."company_id" = lease."company_id"
  AND instance."instance_id" = lease."instance_id"
  AND instance."generation" = lease."generation"
LEFT JOIN "company_runtime_presences" presence
  ON presence."company_id" = instance."company_id"
  AND presence."instance_id" = instance."instance_id"
  AND presence."generation" = instance."generation"
WHERE workspace."company_id" IS NOT NULL
ON CONFLICT ("company_id") DO NOTHING;
--> statement-breakpoint
UPDATE "outbox_deliveries"
SET "status" = 'succeeded',
    "claimed_by" = NULL,
    "claim_token" = NULL,
    "claimed_until_ms" = NULL,
    "last_error_code" = NULL,
    "completed_at_ms" = COALESCE("completed_at_ms", "updated_at_ms")
WHERE "consumer_name" = 'runtime.member-runtime-reactivation'
  AND "status" IN ('pending', 'claimed');
--> statement-breakpoint
UPDATE "outbox_events"
SET "dispatched_at_ms" = COALESCE("dispatched_at_ms", "occurred_at_ms")
WHERE "event_type" IN (
  'company.runtime_provisioning_requested.v1',
  'execution.member_runtime_reactivation_requested.v1'
);
--> statement-breakpoint
DROP TABLE "company_runtime_release_members";
--> statement-breakpoint
DROP TABLE "company_runtime_presences";
--> statement-breakpoint
DROP TABLE "company_runtime_leases";
--> statement-breakpoint
DROP TABLE "company_runtime_instances";
--> statement-breakpoint
DROP TABLE "company_runtime_operations";
--> statement-breakpoint
DROP TABLE "company_runtime_workspaces";
