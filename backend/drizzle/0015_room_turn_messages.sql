ALTER TABLE "rooms"
  ADD COLUMN "next_message_event_sequence" bigint NOT NULL DEFAULT 1;--> statement-breakpoint

UPDATE "rooms" room
SET "next_message_event_sequence" = GREATEST(
  1,
  COALESCE((
    SELECT MAX(message."sequence") + 1
    FROM "room_messages" message
    WHERE message."room_id" = room."id"
  ), 1)
);--> statement-breakpoint

ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_next_message_event_sequence_check"
    CHECK ("next_message_event_sequence" > 0);--> statement-breakpoint

ALTER TABLE "room_messages"
  ADD COLUMN "event_sequence" bigint,
  ADD COLUMN "revision" bigint NOT NULL DEFAULT 1,
  ADD COLUMN "version_group_id" varchar(128),
  ADD COLUMN "version_number" bigint,
  ADD COLUMN "edited_at_ms" bigint,
  ADD COLUMN "deleted_at_ms" bigint;--> statement-breakpoint

UPDATE "room_messages"
SET "event_sequence" = "sequence"
WHERE "event_sequence" IS NULL;--> statement-breakpoint

ALTER TABLE "room_messages"
  ALTER COLUMN "event_sequence" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "room_messages"
  ADD CONSTRAINT "room_messages_event_sequence_check"
    CHECK ("event_sequence" > 0),
  ADD CONSTRAINT "room_messages_revision_check"
    CHECK ("revision" > 0),
  ADD CONSTRAINT "room_messages_version_shape_check"
    CHECK (
      ("version_group_id" IS NULL AND "version_number" IS NULL)
      OR (
        "sender_type" = 'agent'
        AND "version_group_id" IS NOT NULL
        AND "version_number" > 0
      )
    );--> statement-breakpoint

CREATE UNIQUE INDEX "room_messages_room_event_sequence_unique"
  ON "room_messages" ("room_id", "event_sequence");--> statement-breakpoint

CREATE UNIQUE INDEX "room_messages_agent_version_unique"
  ON "room_messages" ("version_group_id", "version_number")
  WHERE "version_group_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "room_messages_version_group_message_unique"
  ON "room_messages" ("version_group_id", "message_id");--> statement-breakpoint

ALTER TABLE "agent_room_executions"
  ADD COLUMN "source_execution_id" varchar(128),
  ADD COLUMN "codex_turn_id" varchar(128),
  ADD COLUMN "turn_message_id" varchar(128);--> statement-breakpoint

ALTER TABLE "agent_room_executions"
  ADD CONSTRAINT "agent_room_executions_source_execution_fk"
    FOREIGN KEY ("source_execution_id")
    REFERENCES "agent_room_executions" ("execution_id")
    ON DELETE SET NULL,
  ADD CONSTRAINT "agent_room_executions_turn_message_fk"
    FOREIGN KEY ("turn_message_id")
    REFERENCES "room_messages" ("message_id")
    ON DELETE SET NULL;--> statement-breakpoint

UPDATE "agent_room_executions" execution
SET "turn_message_id" = (
  SELECT message."message_id"
  FROM "room_messages" message
  WHERE message."source_execution_id" = execution."execution_id"
  ORDER BY message."sequence" DESC
  LIMIT 1
)
WHERE execution."turn_message_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "room_messages" message
    WHERE message."source_execution_id" = execution."execution_id"
  );--> statement-breakpoint

CREATE TABLE "room_message_revisions" (
  "message_id" varchar(128) NOT NULL,
  "revision" bigint NOT NULL,
  "editor_member_id" varchar(128) NOT NULL,
  "markdown" text NOT NULL,
  "plain_text" text NOT NULL,
  "deleted" boolean NOT NULL DEFAULT false,
  "created_at_ms" bigint NOT NULL,
  CONSTRAINT "room_message_revisions_pk" PRIMARY KEY ("message_id", "revision"),
  CONSTRAINT "room_message_revisions_message_fk"
    FOREIGN KEY ("message_id") REFERENCES "room_messages" ("message_id") ON DELETE CASCADE,
  CONSTRAINT "room_message_revisions_editor_fk"
    FOREIGN KEY ("editor_member_id") REFERENCES "actors" ("id") ON DELETE RESTRICT,
  CONSTRAINT "room_message_revisions_revision_check" CHECK ("revision" > 0)
);--> statement-breakpoint

INSERT INTO "room_message_revisions" (
  "message_id", "revision", "editor_member_id", "markdown", "plain_text",
  "deleted", "created_at_ms"
)
SELECT
  message."message_id", 1, message."sender_member_id", message."markdown",
  message."plain_text", false, message."created_at_ms"
FROM "room_messages" message
WHERE message."sender_type" = 'human'
  AND message."sender_member_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

CREATE TABLE "room_agent_reply_version_groups" (
  "version_group_id" varchar(128) PRIMARY KEY,
  "room_id" varchar(128) NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "trigger_message_id" varchar(128) NOT NULL,
  "agent_member_id" varchar(128) NOT NULL,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "room_agent_reply_version_groups_room_fk"
    FOREIGN KEY ("room_id", "company_id")
    REFERENCES "rooms" ("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "room_agent_reply_version_groups_trigger_fk"
    FOREIGN KEY ("trigger_message_id")
    REFERENCES "room_messages" ("message_id") ON DELETE CASCADE,
  CONSTRAINT "room_agent_reply_version_groups_agent_fk"
    FOREIGN KEY ("company_id", "agent_member_id")
    REFERENCES "actors" ("company_id", "id") ON DELETE CASCADE
);--> statement-breakpoint

CREATE UNIQUE INDEX "room_agent_reply_version_groups_trigger_agent_unique"
  ON "room_agent_reply_version_groups" ("trigger_message_id", "agent_member_id");--> statement-breakpoint

INSERT INTO "room_agent_reply_version_groups" (
  "version_group_id", "room_id", "company_id", "trigger_message_id",
  "agent_member_id", "created_at_ms", "updated_at_ms"
)
SELECT
  gen_random_uuid()::text,
  message."room_id",
  message."company_id",
  message."trigger_message_id",
  message."sender_member_id",
  MIN(message."created_at_ms"),
  MAX(message."updated_at_ms")
FROM "room_messages" message
WHERE message."sender_type" = 'agent'
  AND message."trigger_message_id" IS NOT NULL
  AND message."sender_member_id" IS NOT NULL
GROUP BY
  message."room_id",
  message."company_id",
  message."trigger_message_id",
  message."sender_member_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint

WITH numbered AS (
  SELECT
    message."message_id",
    version_group."version_group_id",
    ROW_NUMBER() OVER (
      PARTITION BY version_group."version_group_id"
      ORDER BY message."sequence" ASC
    ) AS "version_number"
  FROM "room_messages" message
  INNER JOIN "room_agent_reply_version_groups" version_group
    ON version_group."room_id" = message."room_id"
    AND version_group."company_id" = message."company_id"
    AND version_group."trigger_message_id" = message."trigger_message_id"
    AND version_group."agent_member_id" = message."sender_member_id"
  WHERE message."sender_type" = 'agent'
)
UPDATE "room_messages" message
SET
  "version_group_id" = numbered."version_group_id",
  "version_number" = numbered."version_number"
FROM numbered
WHERE numbered."message_id" = message."message_id";--> statement-breakpoint

CREATE TABLE "room_agent_reply_selections" (
  "version_group_id" varchar(128) NOT NULL,
  "member_id" varchar(128) NOT NULL,
  "selected_message_id" varchar(128) NOT NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "event_sequence" bigint NOT NULL,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "room_agent_reply_selections_pk"
    PRIMARY KEY ("version_group_id", "member_id"),
  CONSTRAINT "room_agent_reply_selections_group_fk"
    FOREIGN KEY ("version_group_id")
    REFERENCES "room_agent_reply_version_groups" ("version_group_id") ON DELETE CASCADE,
  CONSTRAINT "room_agent_reply_selections_message_fk"
    FOREIGN KEY ("version_group_id", "selected_message_id")
    REFERENCES "room_messages" ("version_group_id", "message_id") ON DELETE CASCADE,
  CONSTRAINT "room_agent_reply_selections_member_fk"
    FOREIGN KEY ("member_id")
    REFERENCES "actors" ("id") ON DELETE CASCADE,
  CONSTRAINT "room_agent_reply_selections_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "room_agent_reply_selections_event_sequence_check" CHECK ("event_sequence" > 0)
);--> statement-breakpoint

CREATE TABLE "room_message_mutation_receipts" (
  "idempotency_key" varchar(255) PRIMARY KEY,
  "room_id" varchar(128) NOT NULL,
  "member_id" varchar(128) NOT NULL,
  "operation" varchar(32) NOT NULL,
  "fingerprint" varchar(128) NOT NULL,
  "result_json" jsonb NOT NULL,
  "created_at_ms" bigint NOT NULL,
  CONSTRAINT "room_message_mutation_receipts_operation_check"
    CHECK ("operation" IN ('edit', 'soft_delete', 'regenerate', 'select_version'))
);--> statement-breakpoint

CREATE INDEX "room_message_mutation_receipts_room_member_idx"
  ON "room_message_mutation_receipts" ("room_id", "member_id", "created_at_ms");--> statement-breakpoint

DROP INDEX "room_interactions_message_unique";--> statement-breakpoint

CREATE INDEX "room_interactions_message_idx"
  ON "room_interactions" ("message_id", "created_at_ms");
