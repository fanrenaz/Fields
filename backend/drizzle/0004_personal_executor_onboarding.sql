ALTER TABLE "company_executors" DROP CONSTRAINT "company_executors_scope_shape_check";--> statement-breakpoint
DO $$
DECLARE
	legacy RECORD;
	owner_id varchar(128);
	target_name varchar(255);
BEGIN
	FOR legacy IN
		SELECT "executor_id", "company_id"
		FROM "company_executors"
		WHERE "scope" = 'company'
		ORDER BY "company_id", "created_at_ms", "executor_id"
	LOOP
		SELECT actor."id"
		INTO owner_id
		FROM "actors" AS actor
		WHERE actor."company_id" = legacy."company_id"
			AND actor."type" = 'human'
			AND actor."company_role" = 'owner'
			AND actor."status" = 'active'
			AND actor."auth_user_id" IS NOT NULL
			AND actor."home_human_actor_id" IS NULL;

		IF owner_id IS NULL THEN
			RAISE EXCEPTION 'cannot migrate Company Executor without an active Company Owner: company_id=% executor_id=%',
				legacy."company_id", legacy."executor_id";
		END IF;

		target_name := 'Company Executor';
		IF EXISTS (
			SELECT 1
			FROM "company_executors" AS existing
			WHERE existing."company_id" = legacy."company_id"
				AND existing."owner_human_actor_id" = owner_id
				AND existing."scope" = 'personal'
				AND existing."name" = target_name
		) THEN
			target_name := left('Company Executor · ' || legacy."executor_id", 255);
		END IF;

		IF EXISTS (
			SELECT 1
			FROM "company_executors" AS existing
			WHERE existing."company_id" = legacy."company_id"
				AND existing."owner_human_actor_id" = owner_id
				AND existing."scope" = 'personal'
				AND existing."name" = target_name
		) THEN
			RAISE EXCEPTION 'cannot migrate Company Executor because its Personal Executor name conflicts: company_id=% executor_id=%',
				legacy."company_id", legacy."executor_id";
		END IF;

		UPDATE "company_executors"
		SET "scope" = 'personal',
			"owner_human_actor_id" = owner_id,
			"name" = target_name,
			"sharing_state" = 'company_shared',
			"is_default" = false
		WHERE "company_id" = legacy."company_id"
			AND "executor_id" = legacy."executor_id";

		INSERT INTO "human_room_executor_preferences" (
			"human_actor_id", "company_id", "executor_id", "created_at_ms", "updated_at_ms"
		)
		SELECT owner_id, legacy."company_id", legacy."executor_id", executor."created_at_ms", executor."updated_at_ms"
		FROM "company_executors" AS executor
		WHERE executor."company_id" = legacy."company_id"
			AND executor."executor_id" = legacy."executor_id"
			AND executor."status" = 'connected'
		ON CONFLICT ("human_actor_id") DO NOTHING;
	END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "company_executors" ALTER COLUMN "scope" SET DEFAULT 'personal';--> statement-breakpoint
ALTER TABLE "company_executors" ALTER COLUMN "is_default" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "company_executors" ADD CONSTRAINT "company_executors_scope_shape_check" CHECK ("company_executors"."scope" = 'personal'
      and "company_executors"."owner_human_actor_id" is not null
      and "company_executors"."name" is not null
      and length(btrim("company_executors"."name")) > 0
      and "company_executors"."is_default" = false
      and "company_executors"."sharing_state" in ('private', 'company_shared', 'admin_blocked')
    );
