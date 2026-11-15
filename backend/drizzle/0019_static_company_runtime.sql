DO $$
BEGIN
  IF (SELECT count(*) FROM "companies") > 1 THEN
    RAISE EXCEPTION 'static Company Runtime requires at most one Company';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "companies_singleton_unique"
  ON "companies" ((true));
--> statement-breakpoint
UPDATE "company_runtime_workspaces" workspace
SET "provider" = 'compose-volume',
    "resource_name" = COALESCE(
      (
        SELECT instance."volume_name"
        FROM "company_runtime_leases" lease
        INNER JOIN "company_runtime_instances" instance
          ON instance."company_id" = lease."company_id"
          AND instance."instance_id" = lease."instance_id"
          AND instance."generation" = lease."generation"
        WHERE lease."company_id" = workspace."company_id"
        LIMIT 1
      ),
      workspace."resource_name"
    );
--> statement-breakpoint
UPDATE "company_runtime_operations"
SET "status" = 'superseded',
    "claimed_by" = NULL,
    "claim_token" = NULL,
    "claimed_until_ms" = NULL,
    "last_error_code" = 'company_runtime_dynamic_release_retired',
    "last_error_retryable" = false
WHERE "release_id" IS NOT NULL
  AND "status" IN ('pending', 'claimed');
--> statement-breakpoint
INSERT INTO "company_runtime_operations" (
  "operation_id", "company_id", "kind", "desired_version", "status", "attempt",
  "claimed_by", "claim_token", "claimed_until_ms", "next_attempt_at_ms",
  "last_error_code", "last_error_retryable", "created_at_ms", "updated_at_ms"
)
SELECT
  'operation_static_cutover',
  company."id",
  'replace',
  COALESCE((
    SELECT max(operation."desired_version")
    FROM "company_runtime_operations" operation
    WHERE operation."company_id" = company."id"
  ), 0) + 1,
  'pending',
  0,
  NULL,
  NULL,
  NULL,
  0,
  NULL,
  NULL,
  0,
  0
FROM "companies" company
ON CONFLICT ("operation_id") DO NOTHING;
