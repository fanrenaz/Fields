ALTER TABLE "actors" ADD COLUMN "system_role" varchar(32);
ALTER TABLE "actors" ADD CONSTRAINT "actors_system_role_check" CHECK ("system_role" is null or "system_role" = 'scheduler');
ALTER TABLE "actors" ADD CONSTRAINT "actors_scheduler_shape_check" CHECK ("system_role" is null or (
  "type" = 'human' and "company_role" = 'member' and "status" = 'active' and "auth_user_id" is null
));
CREATE UNIQUE INDEX "actors_company_scheduler_unique" ON "actors" ("company_id") WHERE "system_role" = 'scheduler';

INSERT INTO "actors" (
  "id", "company_id", "type", "display_name", "mark", "company_role", "status",
  "auth_user_id", "system_role", "created_at_ms", "updated_at_ms"
)
SELECT
  'scheduler_' || md5(company.id), company.id, 'human', '定时任务', '定时', 'member', 'active',
  null, 'scheduler', company.created_at_ms, company.updated_at_ms
FROM "companies" company
ON CONFLICT DO NOTHING;

INSERT INTO "room_memberships" (
  "id", "room_id", "company_id", "actor_id", "role", "status",
  "joined_at_ms", "created_at_ms", "updated_at_ms"
)
SELECT
  'scheduler_room_' || md5(room.id), room.id, room.company_id, scheduler.id,
  'member', 'active', room.created_at_ms, room.created_at_ms, room.updated_at_ms
FROM "rooms" room
JOIN "actors" scheduler ON scheduler.company_id = room.company_id AND scheduler.system_role = 'scheduler'
ON CONFLICT ("room_id", "actor_id") DO NOTHING;

CREATE TABLE "scheduled_tasks" (
  "task_id" varchar(128) PRIMARY KEY,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "created_by_member_id" varchar(128) NOT NULL,
  "name" varchar(255) NOT NULL,
  "scope" varchar(16) NOT NULL,
  "home_owner_member_id" varchar(128),
  "home_thread_mode" varchar(32),
  "home_thread_id" varchar(128),
  "room_id" varchar(128),
  "content_json" jsonb NOT NULL,
  "schedule_type" varchar(16) NOT NULL,
  "schedule_json" jsonb NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "next_run_at_ms" bigint,
  "max_executions" bigint,
  "successful_executions" bigint NOT NULL DEFAULT 0,
  "remaining_executions" bigint,
  "version" bigint NOT NULL DEFAULT 1,
  "blocked_reason" varchar(64),
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  "deleted_at_ms" bigint,
  CONSTRAINT "scheduled_tasks_creator_actor_fk" FOREIGN KEY ("company_id", "created_by_member_id") REFERENCES "actors"("company_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "scheduled_tasks_home_owner_actor_fk" FOREIGN KEY ("company_id", "home_owner_member_id") REFERENCES "actors"("company_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "scheduled_tasks_room_fk" FOREIGN KEY ("room_id", "company_id") REFERENCES "rooms"("id", "company_id") ON DELETE RESTRICT,
  CONSTRAINT "scheduled_tasks_scope_check" CHECK ("scope" in ('home', 'room')),
  CONSTRAINT "scheduled_tasks_target_shape_check" CHECK ((
    "scope" = 'home' and "home_owner_member_id" is not null and "home_thread_mode" in ('existing', 'new_each_run')
      and "room_id" is null and (("home_thread_mode" = 'existing') = ("home_thread_id" is not null))
  ) or (
    "scope" = 'room' and "room_id" is not null and "home_owner_member_id" is null
      and "home_thread_mode" is null and "home_thread_id" is null
  )),
  CONSTRAINT "scheduled_tasks_schedule_type_check" CHECK ("schedule_type" in ('once', 'cron', 'heartbeat')),
  CONSTRAINT "scheduled_tasks_status_check" CHECK ("status" in ('active', 'paused', 'blocked', 'completed')),
  CONSTRAINT "scheduled_tasks_execution_counts_check" CHECK (
    "successful_executions" >= 0 and ("max_executions" is null or "max_executions" > 0)
      and ("remaining_executions" is null or "remaining_executions" >= 0)
  ),
  CONSTRAINT "scheduled_tasks_version_check" CHECK ("version" > 0)
);
CREATE INDEX "scheduled_tasks_company_list_idx" ON "scheduled_tasks" ("company_id", "status", "updated_at_ms");
CREATE INDEX "scheduled_tasks_due_idx" ON "scheduled_tasks" ("next_run_at_ms", "task_id") WHERE "status" = 'active' and "deleted_at_ms" is null;

CREATE TABLE "scheduled_task_runs" (
  "run_id" varchar(128) PRIMARY KEY,
  "task_id" varchar(128) NOT NULL REFERENCES "scheduled_tasks"("task_id") ON DELETE CASCADE,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "trigger" varchar(16) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'queued',
  "occurrence_key" varchar(255) NOT NULL,
  "event_id" varchar(128),
  "scheduled_for_ms" bigint,
  "started_at_ms" bigint,
  "completed_at_ms" bigint,
  "attempt_count" bigint NOT NULL DEFAULT 0,
  "error_reason" varchar(64),
  "room_id" varchar(128),
  "room_message_id" varchar(128),
  "home_thread_id" varchar(128),
  "home_turn_id" varchar(128),
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "scheduled_task_runs_trigger_check" CHECK ("trigger" in ('scheduled', 'run_now')),
  CONSTRAINT "scheduled_task_runs_status_check" CHECK ("status" in ('queued', 'retrying', 'succeeded', 'failed', 'missed', 'skipped')),
  CONSTRAINT "scheduled_task_runs_attempt_check" CHECK ("attempt_count" >= 0)
);
CREATE UNIQUE INDEX "scheduled_task_runs_occurrence_unique" ON "scheduled_task_runs" ("task_id", "occurrence_key");
CREATE UNIQUE INDEX "scheduled_task_runs_event_unique" ON "scheduled_task_runs" ("event_id");
CREATE INDEX "scheduled_task_runs_task_history_idx" ON "scheduled_task_runs" ("task_id", "created_at_ms" DESC);
CREATE INDEX "scheduled_task_runs_retention_idx" ON "scheduled_task_runs" ("completed_at_ms");

CREATE TABLE "scheduled_task_mutation_receipts" (
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "actor_id" varchar(128) NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "operation" varchar(32) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "task_id" varchar(128) NOT NULL REFERENCES "scheduled_tasks"("task_id") ON DELETE CASCADE,
  "response_json" jsonb NOT NULL,
  "created_at_ms" bigint NOT NULL
);
CREATE UNIQUE INDEX "scheduled_task_mutation_receipts_key_unique" ON "scheduled_task_mutation_receipts" ("company_id", "actor_id", "idempotency_key");
CREATE INDEX "scheduled_task_mutation_receipts_task_idx" ON "scheduled_task_mutation_receipts" ("task_id");
