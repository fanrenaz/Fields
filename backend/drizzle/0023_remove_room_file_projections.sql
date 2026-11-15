UPDATE "agent_room_executions"
SET "company_file_inputs_json" = NULL
WHERE "company_file_inputs_json" IS NOT NULL;

DROP TABLE IF EXISTS "room_file_references";
