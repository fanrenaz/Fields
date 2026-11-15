CREATE TABLE "home_agent_executor_assignments" (
	"home_agent_actor_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"executor_id" varchar(128) NOT NULL,
	"assignment_version" bigint DEFAULT 1 NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_room_executor_preferences" (
	"human_actor_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"executor_id" varchar(128) NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_onboarding_processes" ALTER COLUMN "executor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "company_executors" ADD COLUMN "scope" varchar(32) DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_executors" ADD COLUMN "owner_human_actor_id" varchar(128);--> statement-breakpoint
ALTER TABLE "company_executors" ADD COLUMN "name" varchar(255);--> statement-breakpoint
ALTER TABLE "company_executors" ADD COLUMN "sharing_state" varchar(32);--> statement-breakpoint
ALTER TABLE "room_memberships" ADD COLUMN "executor_id" varchar(128);--> statement-breakpoint
UPDATE "room_memberships" AS membership
SET "executor_id" = executor."executor_id"
FROM "company_executors" AS executor
WHERE executor."company_id" = membership."company_id"
  AND executor."is_default" = true;--> statement-breakpoint
UPDATE "room_actor_bindings" AS binding
SET "executor_id" = executor."executor_id"
FROM "company_executors" AS executor
WHERE executor."company_id" = binding."company_id"
  AND executor."is_default" = true
  AND binding."executor_id" IS NULL;--> statement-breakpoint
INSERT INTO "home_agent_executor_assignments" (
	"home_agent_actor_id", "company_id", "executor_id", "assignment_version", "created_at_ms", "updated_at_ms"
)
SELECT actor."id", actor."company_id", executor."executor_id", 1, actor."created_at_ms", actor."updated_at_ms"
FROM "actors" AS actor
INNER JOIN "company_executors" AS executor
	ON executor."company_id" = actor."company_id" AND executor."is_default" = true
WHERE actor."home_human_actor_id" IS NOT NULL
ON CONFLICT ("home_agent_actor_id") DO NOTHING;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "room_memberships" WHERE "executor_id" IS NULL) THEN
		RAISE EXCEPTION 'cannot migrate Room membership without a Company default Executor';
	END IF;
	IF EXISTS (SELECT 1 FROM "room_actor_bindings" WHERE "executor_id" IS NULL) THEN
		RAISE EXCEPTION 'cannot migrate Room actor binding without a Company default Executor';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "actors" AS actor
		LEFT JOIN "home_agent_executor_assignments" AS assignment
			ON assignment."company_id" = actor."company_id"
			AND assignment."home_agent_actor_id" = actor."id"
		WHERE actor."home_human_actor_id" IS NOT NULL
			AND assignment."home_agent_actor_id" IS NULL
	) THEN
		RAISE EXCEPTION 'cannot migrate Home Agent without a Company default Executor';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "room_memberships" ALTER COLUMN "executor_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "room_actor_bindings" ALTER COLUMN "executor_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "company_executors_company_id_unique";--> statement-breakpoint
ALTER TABLE "home_agent_executor_assignments" ADD CONSTRAINT "home_agent_executor_assignments_home_agent_fk" FOREIGN KEY ("company_id","home_agent_actor_id") REFERENCES "public"."actors"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_agent_executor_assignments" ADD CONSTRAINT "home_agent_executor_assignments_executor_fk" FOREIGN KEY ("company_id","executor_id") REFERENCES "public"."company_executors"("company_id","executor_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_room_executor_preferences" ADD CONSTRAINT "human_room_executor_preferences_human_fk" FOREIGN KEY ("company_id","human_actor_id") REFERENCES "public"."actors"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_room_executor_preferences" ADD CONSTRAINT "human_room_executor_preferences_executor_fk" FOREIGN KEY ("company_id","executor_id") REFERENCES "public"."company_executors"("company_id","executor_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "home_agent_executor_assignments_company_id_idx" ON "home_agent_executor_assignments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "human_room_executor_preferences_company_id_idx" ON "human_room_executor_preferences" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "company_executors" ADD CONSTRAINT "company_executors_owner_human_actor_fk" FOREIGN KEY ("company_id","owner_human_actor_id") REFERENCES "public"."actors"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_company_executor_fk" FOREIGN KEY ("company_id","executor_id") REFERENCES "public"."company_executors"("company_id","executor_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_executors_owner_name_unique" ON "company_executors" USING btree ("company_id","owner_human_actor_id","name") WHERE "company_executors"."scope" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "company_executors_company_account_unique" ON "company_executors" USING btree ("company_id","account_id") WHERE "company_executors"."account_id" is not null;--> statement-breakpoint
ALTER TABLE "company_executors" ADD CONSTRAINT "company_executors_scope_shape_check" CHECK ((
      "company_executors"."scope" = 'company'
      and "company_executors"."owner_human_actor_id" is null
      and "company_executors"."name" is null
      and "company_executors"."sharing_state" is null
    ) or (
      "company_executors"."scope" = 'personal'
      and "company_executors"."owner_human_actor_id" is not null
      and "company_executors"."name" is not null
      and length(btrim("company_executors"."name")) > 0
      and "company_executors"."is_default" = false
      and "company_executors"."sharing_state" in ('private', 'company_shared', 'admin_blocked')
    ));
