CREATE TABLE "company_assets" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "slug" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "lifecycle" varchar(32) DEFAULT 'draft' NOT NULL,
  "revision" bigint DEFAULT 1 NOT NULL,
  "current_version_id" varchar(128),
  "created_by_actor_id" varchar(128) NOT NULL,
  "updated_by_actor_id" varchar(128) NOT NULL,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  "archived_at_ms" bigint,
  CONSTRAINT "company_assets_kind_check" CHECK ("kind" in ('plugin', 'skill', 'mcp')),
  CONSTRAINT "company_assets_lifecycle_check" CHECK ("lifecycle" in ('draft', 'published', 'archived')),
  CONSTRAINT "company_assets_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "company_assets_reserved_identity_check" CHECK ("slug" <> 'fields-core' and lower("name") <> 'fields-core')
);
--> statement-breakpoint
CREATE TABLE "company_asset_drafts" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "asset_id" varchar(128) NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "slug" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "version" varchar(128),
  "revision" bigint DEFAULT 1 NOT NULL,
  "source" jsonb,
  "credential_operation_id" varchar(128),
  "content_sha256" varchar(64),
  "files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "validation" jsonb NOT NULL,
  "created_by_actor_id" varchar(128) NOT NULL,
  "updated_by_actor_id" varchar(128) NOT NULL,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_asset_drafts_kind_check" CHECK ("kind" in ('plugin', 'skill', 'mcp')),
  CONSTRAINT "company_asset_drafts_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "company_asset_drafts_reserved_identity_check" CHECK ("slug" <> 'fields-core' and lower("name") <> 'fields-core')
);
--> statement-breakpoint
CREATE TABLE "company_asset_versions" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "source_draft_id" varchar(128) NOT NULL,
  "asset_id" varchar(128) NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "slug" varchar(255) NOT NULL,
  "version" varchar(128) NOT NULL,
  "revision" bigint DEFAULT 1 NOT NULL,
  "source" jsonb NOT NULL,
  "content_sha256" varchar(64) NOT NULL,
  "files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "validation" jsonb NOT NULL,
  "published_by_actor_id" varchar(128) NOT NULL,
  "published_at_ms" bigint NOT NULL,
  CONSTRAINT "company_asset_versions_kind_check" CHECK ("kind" in ('plugin', 'skill', 'mcp')),
  CONSTRAINT "company_asset_versions_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "company_asset_versions_reserved_identity_check" CHECK ("slug" <> 'fields-core')
);
--> statement-breakpoint
CREATE TABLE "company_asset_version_credentials" (
  "version_id" varchar(128) PRIMARY KEY NOT NULL,
  "asset_id" varchar(128) NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "revision" bigint DEFAULT 1 NOT NULL,
  "credential_operation_id" varchar(128),
  "credential_configured" boolean DEFAULT false NOT NULL,
  "updated_by_actor_id" varchar(128) NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_asset_version_credentials_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "company_asset_mutation_receipts" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "actor_id" varchar(128) NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "operation" varchar(64) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "phase" varchar(64) DEFAULT 'claimed' NOT NULL,
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result" jsonb,
  "error_code" varchar(128),
  "error_retryable" boolean,
  "lease_owner" varchar(128),
  "lease_expires_at_ms" bigint,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  "completed_at_ms" bigint,
  CONSTRAINT "company_asset_receipts_status_check" CHECK ("status" in ('pending', 'completed', 'failed')),
  CONSTRAINT "company_asset_receipts_result_check" CHECK (
    ("status" = 'pending' and "result" is null and "error_code" is null and "error_retryable" is null)
    or ("status" = 'completed' and "result" is not null and "error_code" is null and "error_retryable" is null)
    or ("status" = 'failed' and "result" is null and "error_code" is not null and "error_retryable" is not null)
  ),
  CONSTRAINT "company_asset_receipts_lease_check" CHECK (
    ("status" = 'pending' and "lease_owner" is not null and "lease_expires_at_ms" is not null and "completed_at_ms" is null)
    or ("status" in ('completed', 'failed') and "lease_owner" is null and "lease_expires_at_ms" is null and "completed_at_ms" is not null)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "company_assets_company_id_unique"
  ON "company_assets" USING btree ("company_id","id");
--> statement-breakpoint
ALTER TABLE "company_assets" ADD CONSTRAINT "company_assets_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "company_asset_drafts" ADD CONSTRAINT "company_asset_drafts_company_asset_fk"
  FOREIGN KEY ("company_id","asset_id") REFERENCES "public"."company_assets"("company_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "company_asset_drafts" ADD CONSTRAINT "company_asset_drafts_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "company_asset_versions" ADD CONSTRAINT "company_asset_versions_company_asset_fk"
  FOREIGN KEY ("company_id","asset_id") REFERENCES "public"."company_assets"("company_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "company_asset_versions" ADD CONSTRAINT "company_asset_versions_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "company_asset_mutation_receipts" ADD CONSTRAINT "company_asset_receipts_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "company_assets_company_kind_slug_unique"
  ON "company_assets" USING btree ("company_id","kind","slug");
--> statement-breakpoint
CREATE INDEX "company_assets_company_lifecycle_idx"
  ON "company_assets" USING btree ("company_id","lifecycle","updated_at_ms");
--> statement-breakpoint
CREATE INDEX "company_asset_drafts_company_idx"
  ON "company_asset_drafts" USING btree ("company_id","updated_at_ms");
--> statement-breakpoint
CREATE INDEX "company_asset_drafts_asset_idx"
  ON "company_asset_drafts" USING btree ("asset_id","updated_at_ms");
--> statement-breakpoint
CREATE UNIQUE INDEX "company_asset_versions_asset_version_unique"
  ON "company_asset_versions" USING btree ("asset_id","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "company_asset_versions_source_draft_unique"
  ON "company_asset_versions" USING btree ("company_id","source_draft_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "company_asset_versions_company_kind_slug_version_unique"
  ON "company_asset_versions" USING btree ("company_id","kind","slug","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "company_asset_versions_company_asset_id_unique"
  ON "company_asset_versions" USING btree ("company_id","asset_id","id");
--> statement-breakpoint
CREATE INDEX "company_asset_version_credentials_asset_idx"
  ON "company_asset_version_credentials" USING btree ("company_id","asset_id");
--> statement-breakpoint
ALTER TABLE "company_asset_version_credentials"
  ADD CONSTRAINT "company_asset_version_credentials_version_fk"
  FOREIGN KEY ("company_id","asset_id","version_id")
  REFERENCES "public"."company_asset_versions"("company_id","asset_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "company_asset_versions_asset_published_idx"
  ON "company_asset_versions" USING btree ("asset_id","published_at_ms");
--> statement-breakpoint
ALTER TABLE "company_assets" ADD CONSTRAINT "company_assets_current_version_fk"
  FOREIGN KEY ("company_id","id","current_version_id")
  REFERENCES "public"."company_asset_versions"("company_id","asset_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "company_asset_receipts_actor_key_unique"
  ON "company_asset_mutation_receipts" USING btree ("company_id","actor_id","idempotency_key");
