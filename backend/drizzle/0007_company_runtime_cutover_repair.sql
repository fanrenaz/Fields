-- Repair the 0006 destructive cutover for Companies that predated the
-- single-Company Runtime model. 0006 intentionally retired the old Runtime
-- fleets, but left existing Companies active without creating a replacement
-- provisioning operation.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "companies" company
    WHERE company."status" = 'active'
      AND (
        EXISTS (
          SELECT 1 FROM "company_onboarding_processes" process
          WHERE process."company_id" = company."id"
        )
        OR EXISTS (
          SELECT 1 FROM "company_runtime_workspaces" workspace
          WHERE workspace."company_id" = company."id"
        )
        OR EXISTS (
          SELECT 1 FROM "company_runtime_operations" operation
          WHERE operation."company_id" = company."id"
        )
        OR EXISTS (
          SELECT 1 FROM "company_runtime_instances" instance
          WHERE instance."company_id" = company."id"
        )
        OR EXISTS (
          SELECT 1 FROM "company_runtime_leases" lease
          WHERE lease."company_id" = company."id"
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "company_onboarding_processes" process
        INNER JOIN "company_runtime_workspaces" workspace
          ON workspace."company_id" = process."company_id"
        INNER JOIN "company_runtime_leases" lease
          ON lease."company_id" = process."company_id"
          AND lease."status" = 'ready'
        INNER JOIN "company_runtime_instances" instance
          ON instance."company_id" = lease."company_id"
          AND instance."instance_id" = lease."instance_id"
          AND instance."generation" = lease."generation"
          AND instance."observed_state" = 'ready'
        WHERE process."company_id" = company."id"
          AND process."stage" = 'ready'
          AND workspace."status" = 'ready'
      )
  ) THEN
    RAISE EXCEPTION
      'company_runtime_cutover_repair found an active Company with a partial Runtime topology';
  END IF;

  IF EXISTS (
    SELECT company."id"
    FROM "companies" company
    LEFT JOIN "actors" owner
      ON owner."company_id" = company."id"
      AND owner."type" = 'human'
      AND owner."company_role" = 'owner'
      AND owner."status" = 'active'
    WHERE company."status" = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM "company_onboarding_processes" process
        WHERE process."company_id" = company."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "company_runtime_workspaces" workspace
        WHERE workspace."company_id" = company."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "company_runtime_operations" operation
        WHERE operation."company_id" = company."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "company_runtime_instances" instance
        WHERE instance."company_id" = company."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "company_runtime_leases" lease
        WHERE lease."company_id" = company."id"
      )
    GROUP BY company."id"
    HAVING count(owner."id") <> 1
  ) THEN
    RAISE EXCEPTION
      'company_runtime_cutover_repair requires exactly one active Human Owner per Company';
  END IF;
END
$$;

CREATE TEMPORARY TABLE "_company_runtime_cutover_repair_targets"
ON COMMIT DROP
AS
SELECT
  company."id" AS "company_id",
  min(owner."id") AS "owner_actor_id",
  (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "repaired_at_ms"
FROM "companies" company
INNER JOIN "actors" owner
  ON owner."company_id" = company."id"
  AND owner."type" = 'human'
  AND owner."company_role" = 'owner'
  AND owner."status" = 'active'
WHERE company."status" = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM "company_onboarding_processes" process
    WHERE process."company_id" = company."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "company_runtime_workspaces" workspace
    WHERE workspace."company_id" = company."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "company_runtime_operations" operation
    WHERE operation."company_id" = company."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "company_runtime_instances" instance
    WHERE instance."company_id" = company."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "company_runtime_leases" lease
    WHERE lease."company_id" = company."id"
  )
GROUP BY company."id";

INSERT INTO "company_onboarding_processes" (
  "company_id",
  "owner_actor_id",
  "runtime_id",
  "executor_id",
  "initial_operation_id",
  "stage",
  "version",
  "last_error_code",
  "last_error_retryable",
  "created_at_ms",
  "updated_at_ms"
)
SELECT
  target."company_id",
  target."owner_actor_id",
  'runtime_cutover_' || md5(target."company_id"),
  NULL,
  'operation_cutover_' || md5(target."company_id"),
  'creatingRuntime',
  1,
  NULL,
  NULL,
  target."repaired_at_ms",
  target."repaired_at_ms"
FROM "_company_runtime_cutover_repair_targets" target;

INSERT INTO "company_runtime_workspaces" (
  "company_id",
  "provider",
  "resource_name",
  "status",
  "last_error_code",
  "last_error_retryable",
  "created_at_ms",
  "updated_at_ms"
)
SELECT
  target."company_id",
  'docker-volume',
  'company-runtime-' || target."company_id",
  'pending',
  NULL,
  NULL,
  target."repaired_at_ms",
  target."repaired_at_ms"
FROM "_company_runtime_cutover_repair_targets" target;

INSERT INTO "company_runtime_operations" (
  "operation_id",
  "company_id",
  "kind",
  "desired_version",
  "status",
  "attempt",
  "claimed_by",
  "claim_token",
  "claimed_until_ms",
  "next_attempt_at_ms",
  "last_error_code",
  "last_error_retryable",
  "created_at_ms",
  "updated_at_ms"
)
SELECT
  'operation_cutover_' || md5(target."company_id"),
  target."company_id",
  'provision',
  1,
  'pending',
  0,
  NULL,
  NULL,
  NULL,
  target."repaired_at_ms",
  NULL,
  NULL,
  target."repaired_at_ms",
  target."repaired_at_ms"
FROM "_company_runtime_cutover_repair_targets" target;

UPDATE "companies" company
SET
  "status" = 'provisioning',
  "updated_at_ms" = target."repaired_at_ms"
FROM "_company_runtime_cutover_repair_targets" target
WHERE company."id" = target."company_id";
