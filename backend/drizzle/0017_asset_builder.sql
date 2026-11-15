CREATE TABLE "asset_builder_topics" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "human_member_id" varchar(128) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "asset_id" varchar(128),
  "draft_id" varchar(128),
  "title" varchar(120) NOT NULL,
  "thread_id" varchar(255),
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "asset_builder_topics_human_fk" FOREIGN KEY ("company_id","human_member_id")
    REFERENCES "public"."actors"("company_id","id") ON DELETE cascade,
  CONSTRAINT "asset_builder_topics_asset_fk" FOREIGN KEY ("asset_id")
    REFERENCES "company_assets"("id") ON DELETE set null,
  CONSTRAINT "asset_builder_topics_draft_fk" FOREIGN KEY ("draft_id")
    REFERENCES "company_asset_drafts"("id") ON DELETE set null,
  CONSTRAINT "asset_builder_topics_kind_check" CHECK ("kind" IN ('plugin','skill','mcp'))
);

CREATE INDEX "asset_builder_topics_operator_target_idx"
  ON "asset_builder_topics" USING btree (
    "company_id","human_member_id","kind","asset_id","updated_at_ms"
  );
CREATE UNIQUE INDEX "asset_builder_topics_operator_thread_unique"
  ON "asset_builder_topics" USING btree ("company_id","human_member_id","thread_id");
