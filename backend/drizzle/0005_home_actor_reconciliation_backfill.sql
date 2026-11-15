DO $$
DECLARE
	pair RECORD;
	repair_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
	FOR pair IN
		SELECT
			human."company_id",
			human."id" AS "human_actor_id",
			home."id" AS "home_actor_id"
		FROM "actors" AS human
		INNER JOIN "actors" AS home
			ON home."company_id" = human."company_id"
			AND home."home_human_actor_id" = human."id"
		WHERE human."type" = 'human'
			AND human."status" = 'active'
			AND human."auth_user_id" IS NOT NULL
			AND human."home_human_actor_id" IS NULL
			AND home."type" = 'agent'
			AND home."status" = 'active'
			AND home."auth_user_id" IS NULL
			AND home."company_role" = 'member'
			AND NOT EXISTS (
				SELECT 1
				FROM "outbox_events" AS existing_event
				WHERE existing_event."event_type" = 'actor.human_reconciled.v1'
					AND existing_event."schema_version" = 1
					AND existing_event."aggregate_type" = 'actor'
					AND existing_event."aggregate_id" = human."id"
					AND existing_event."payload_json"->>'company_id' = human."company_id"
					AND existing_event."payload_json"->>'human_actor_id' = human."id"
					AND existing_event."payload_json"->>'home_actor_id' = home."id"
					AND existing_event."payload_json"->>'actor_status' = 'active'
			)
		ORDER BY human."company_id", human."id"
	LOOP
		INSERT INTO "outbox_events" (
			"event_id", "event_type", "schema_version", "aggregate_type", "aggregate_id",
			"payload_json", "occurred_at_ms", "dispatched_at_ms"
		)
		VALUES (
			'event_home_actor_backfill_' || md5(
				pair."company_id" || ':' || pair."human_actor_id" || ':' || pair."home_actor_id"
			),
			'actor.human_reconciled.v1',
			1,
			'actor',
			pair."human_actor_id",
			jsonb_build_object(
				'company_id', pair."company_id",
				'human_actor_id', pair."human_actor_id",
				'home_actor_id', pair."home_actor_id",
				'actor_status', 'active',
				'occurred_at_ms', repair_ms
			),
			repair_ms,
			NULL
		)
		ON CONFLICT ("event_id") DO NOTHING;

		UPDATE "outbox_deliveries" AS delivery
		SET "status" = 'pending',
			"attempt" = 0,
			"next_attempt_at_ms" = repair_ms,
			"claimed_by" = NULL,
			"claim_token" = NULL,
			"claimed_until_ms" = NULL,
			"last_error_code" = NULL,
			"updated_at_ms" = repair_ms,
			"completed_at_ms" = NULL
		FROM "outbox_events" AS failed_event
		INNER JOIN "home_agent_executor_assignments" AS assignment
			ON assignment."company_id" = pair."company_id"
			AND assignment."home_agent_actor_id" = pair."home_actor_id"
			AND assignment."executor_id" = failed_event."payload_json"->>'executor_id'
		WHERE delivery."event_id" = failed_event."event_id"
			AND delivery."consumer_name" = 'execution.executor-reconfiguration'
			AND delivery."status" = 'dead_letter'
			AND delivery."last_error_code" = 'EXECUTOR_RECONFIGURATION_UNAVAILABLE'
			AND failed_event."event_type" = 'execution.executor_configuration_changed.v1'
			AND failed_event."schema_version" = 1
			AND failed_event."aggregate_type" = 'executor'
			AND failed_event."payload_json"->>'company_id' = pair."company_id"
			AND failed_event."payload_json"->>'home_actor_id' = pair."home_actor_id"
			AND failed_event."payload_json"->>'cause' = 'home_assignment_changed';
	END LOOP;
END $$;
