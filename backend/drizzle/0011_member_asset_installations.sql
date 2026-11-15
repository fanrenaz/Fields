CREATE TABLE "member_asset_profiles" (
  "company_id" varchar(128) NOT NULL,
  "member_id" varchar(128) PRIMARY KEY NOT NULL,
  "revision" bigint DEFAULT 0 NOT NULL,
  "pending_operation_id" varchar(128),
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "member_asset_profiles_revision_check" CHECK ("revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_asset_profiles_company_member_unique"
  ON "member_asset_profiles" USING btree ("company_id","member_id");
--> statement-breakpoint
ALTER TABLE "member_asset_profiles"
  ADD CONSTRAINT "member_asset_profiles_actor_fk"
  FOREIGN KEY ("company_id","member_id")
  REFERENCES "public"."actors"("company_id","id")
  ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE "member_asset_installations" (
  "company_id" varchar(128) NOT NULL,
  "member_id" varchar(128) NOT NULL,
  "asset_id" varchar(128) NOT NULL,
  "version_id" varchar(128) NOT NULL,
  "ordinal" bigint NOT NULL,
  "health" varchar(32) DEFAULT 'ready' NOT NULL,
  "issue_code" varchar(128),
  "installed_at_ms" bigint NOT NULL,
  CONSTRAINT "member_asset_installations_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "member_asset_installations_health_check" CHECK ("health" in ('ready', 'degraded')),
  CONSTRAINT "member_asset_installations_issue_check" CHECK (
    ("health" = 'ready' and "issue_code" is null)
    or ("health" = 'degraded' and "issue_code" is not null)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_asset_installations_member_version_unique"
  ON "member_asset_installations" USING btree ("company_id","member_id","version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "member_asset_installations_member_asset_unique"
  ON "member_asset_installations" USING btree ("company_id","member_id","asset_id");
--> statement-breakpoint
CREATE INDEX "member_asset_installations_version_idx"
  ON "member_asset_installations" USING btree ("company_id","version_id");
--> statement-breakpoint
ALTER TABLE "member_asset_installations"
  ADD CONSTRAINT "member_asset_installations_profile_fk"
  FOREIGN KEY ("company_id","member_id")
  REFERENCES "public"."member_asset_profiles"("company_id","member_id")
  ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "member_asset_installations"
  ADD CONSTRAINT "member_asset_installations_version_fk"
  FOREIGN KEY ("company_id","asset_id","version_id")
  REFERENCES "public"."company_asset_versions"("company_id","asset_id","id")
  ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "member_asset_operations" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "member_id" varchar(128) NOT NULL,
  "requested_by_actor_id" varchar(128) NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "base_revision" bigint NOT NULL,
  "requested_revision" bigint NOT NULL,
  "targets" jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "error_code" varchar(128),
  "retryable" boolean,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  "completed_at_ms" bigint,
  CONSTRAINT "member_asset_operations_revision_check"
    CHECK ("base_revision" >= 0 and "requested_revision" = "base_revision" + 1),
  CONSTRAINT "member_asset_operations_status_check"
    CHECK ("status" in ('pending', 'applying', 'applied', 'failed')),
  CONSTRAINT "member_asset_operations_result_check" CHECK (
    ("status" in ('pending', 'applying') and "error_code" is null and "retryable" is null and "completed_at_ms" is null)
    or ("status" = 'applied' and "error_code" is null and "retryable" is null and "completed_at_ms" is not null)
    or ("status" = 'failed' and "error_code" is not null and "retryable" is not null and "completed_at_ms" is not null)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_asset_operations_actor_key_unique"
  ON "member_asset_operations" USING btree ("company_id","requested_by_actor_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "member_asset_operations_member_idx"
  ON "member_asset_operations" USING btree ("company_id","member_id","created_at_ms");
--> statement-breakpoint
ALTER TABLE "member_asset_operations"
  ADD CONSTRAINT "member_asset_operations_member_fk"
  FOREIGN KEY ("company_id","member_id")
  REFERENCES "public"."actors"("company_id","id")
  ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "member_asset_operations"
  ADD CONSTRAINT "member_asset_operations_requester_fk"
  FOREIGN KEY ("company_id","requested_by_actor_id")
  REFERENCES "public"."actors"("company_id","id")
  ON DELETE restrict;
