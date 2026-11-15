UPDATE "company_runtime_instances" instance
SET "runtime_url" = 'http://backend:4110',
    "container_name" = 'backend',
    "container_id" = 'backend'
FROM "company_runtime_leases" lease
WHERE lease."company_id" = instance."company_id"
  AND lease."instance_id" = instance."instance_id"
  AND lease."generation" = instance."generation";
