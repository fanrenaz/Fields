CREATE TABLE "notification_activities" (
  "activity_id" varchar(128) PRIMARY KEY NOT NULL,
  "source_event_id" varchar(256) NOT NULL,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "recipient_actor_id" varchar(128) NOT NULL REFERENCES "actors"("id") ON DELETE CASCADE,
  "kind" varchar(32) NOT NULL,
  "target_kind" varchar(16) NOT NULL,
  "target_id" varchar(256) NOT NULL,
  "target_title" varchar(255) NOT NULL,
  "target_message_id" varchar(128),
  "body" varchar(240),
  "status" varchar(32),
  "sequence" bigserial NOT NULL,
  "occurred_at_ms" bigint NOT NULL,
  "created_at_ms" bigint NOT NULL,
  CONSTRAINT "notification_activities_kind_check" CHECK ("kind" IN ('room.message', 'agent.terminal')),
  CONSTRAINT "notification_activities_target_kind_check" CHECK ("target_kind" IN ('home', 'room')),
  CONSTRAINT "notification_activities_status_check" CHECK ("status" IS NULL OR "status" IN ('completed', 'failed', 'interrupted'))
);
CREATE UNIQUE INDEX "notification_activities_source_event_unique" ON "notification_activities" ("source_event_id");
CREATE UNIQUE INDEX "notification_activities_sequence_unique" ON "notification_activities" ("sequence");
CREATE INDEX "notification_activities_recipient_sequence_idx" ON "notification_activities" ("company_id", "recipient_actor_id", "sequence" DESC);
CREATE INDEX "notification_activities_target_sequence_idx" ON "notification_activities" ("company_id", "recipient_actor_id", "target_kind", "target_id", "sequence" DESC);

CREATE TABLE "notification_read_cursors" (
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "recipient_actor_id" varchar(128) NOT NULL REFERENCES "actors"("id") ON DELETE CASCADE,
  "target_kind" varchar(16) NOT NULL,
  "target_id" varchar(256) NOT NULL,
  "through_sequence" bigint NOT NULL DEFAULT 0,
  "updated_at_ms" bigint NOT NULL,
  PRIMARY KEY ("company_id", "recipient_actor_id", "target_kind", "target_id"),
  CONSTRAINT "notification_read_cursors_target_kind_check" CHECK ("target_kind" IN ('home', 'room'))
);

CREATE TABLE "notification_push_subscriptions" (
  "subscription_id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "recipient_actor_id" varchar(128) NOT NULL REFERENCES "actors"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "locale" varchar(8) NOT NULL,
  "expiration_time_ms" bigint,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL
);
CREATE INDEX "notification_push_subscriptions_recipient_idx" ON "notification_push_subscriptions" ("company_id", "recipient_actor_id");
CREATE UNIQUE INDEX "notification_push_subscriptions_endpoint_unique" ON "notification_push_subscriptions" ("endpoint");
ALTER TABLE "notification_push_subscriptions" ADD CONSTRAINT "notification_push_subscriptions_locale_check" CHECK ("locale" IN ('en', 'zh-CN', 'zh-TW'));

CREATE TABLE "notification_push_deliveries" (
  "activity_id" varchar(128) NOT NULL REFERENCES "notification_activities"("activity_id") ON DELETE CASCADE,
  "subscription_id" varchar(128) NOT NULL REFERENCES "notification_push_subscriptions"("subscription_id") ON DELETE CASCADE,
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "attempt" integer NOT NULL DEFAULT 0,
  "next_attempt_at_ms" bigint NOT NULL,
  "claim_token" varchar(128),
  "claimed_until_ms" bigint,
  "last_error_code" varchar(128),
  "updated_at_ms" bigint NOT NULL,
  PRIMARY KEY ("activity_id", "subscription_id"),
  CONSTRAINT "notification_push_deliveries_status_check" CHECK ("status" IN ('pending', 'claimed', 'succeeded', 'dead_letter'))
);
CREATE INDEX "notification_push_deliveries_due_idx" ON "notification_push_deliveries" ("status", "next_attempt_at_ms");
