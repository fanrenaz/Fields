CREATE TABLE "agent_builder_profiles" (
  "company_id" varchar(128) NOT NULL,
  "agent_member_id" varchar(128) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "avatar" varchar(32) DEFAULT '🤖' NOT NULL,
  "instructions" text DEFAULT '' NOT NULL,
  "readiness" varchar(32) DEFAULT 'draft' NOT NULL,
  "revision" bigint DEFAULT 0 NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "agent_builder_profiles_company_agent_unique" UNIQUE("company_id","agent_member_id"),
  CONSTRAINT "agent_builder_profiles_agent_fk" FOREIGN KEY ("company_id","agent_member_id")
    REFERENCES "public"."actors"("company_id","id") ON DELETE cascade
);

CREATE TABLE "agent_builder_topics" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "human_member_id" varchar(128) NOT NULL,
  "agent_member_id" varchar(128) NOT NULL,
  "title" varchar(120) NOT NULL,
  "thread_id" varchar(255),
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "agent_builder_topics_human_fk" FOREIGN KEY ("company_id","human_member_id")
    REFERENCES "public"."actors"("company_id","id") ON DELETE cascade,
  CONSTRAINT "agent_builder_topics_agent_fk" FOREIGN KEY ("company_id","agent_member_id")
    REFERENCES "public"."actors"("company_id","id") ON DELETE cascade
);

CREATE INDEX "agent_builder_topics_operator_agent_idx"
  ON "agent_builder_topics" USING btree ("company_id","human_member_id","agent_member_id","updated_at_ms");
CREATE UNIQUE INDEX "agent_builder_topics_operator_thread_unique"
  ON "agent_builder_topics" USING btree ("company_id","human_member_id","thread_id");
