DROP INDEX IF EXISTS "company_runtime_operations_release_unique";

ALTER TABLE "company_runtime_operations"
  DROP CONSTRAINT "company_runtime_operations_status_check";

ALTER TABLE "company_runtime_operations"
  ADD CONSTRAINT "company_runtime_operations_status_check"
  CHECK ("status" IN ('pending', 'claimed', 'succeeded', 'failed', 'superseded'));
