ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "scheduled_tasks_scope_check";
ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "scheduled_tasks_target_shape_check";
ALTER TABLE "scheduled_tasks" RENAME COLUMN "scope" TO "target_kind";

UPDATE "scheduled_tasks"
SET "content_json" = ("content_json" - 'scope') || jsonb_build_object('kind', "content_json" -> 'scope')
WHERE "content_json" ? 'scope';

UPDATE "scheduled_task_mutation_receipts"
SET "response_json" =
  jsonb_set(
    jsonb_set("response_json", '{target,kind}', "response_json" #> '{target,scope}', true) #- '{target,scope}',
    '{content,kind}',
    "response_json" #> '{content,scope}',
    true
  ) #- '{content,scope}'
WHERE "response_json" #> '{target,scope}' IS NOT NULL
  AND "response_json" #> '{content,scope}' IS NOT NULL;

ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_target_kind_check"
  CHECK ("target_kind" IN ('home', 'room'));
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_target_shape_check" CHECK ((
  "target_kind" = 'home' AND "home_owner_member_id" IS NOT NULL
    AND "home_thread_mode" IN ('existing', 'new_each_run') AND "room_id" IS NULL
    AND (("home_thread_mode" = 'existing') = ("home_thread_id" IS NOT NULL))
) OR (
  "target_kind" = 'room' AND "room_id" IS NOT NULL
    AND "home_owner_member_id" IS NULL AND "home_thread_mode" IS NULL AND "home_thread_id" IS NULL
));
