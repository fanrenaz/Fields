CREATE TABLE "company_file_folders" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "parent_folder_id" varchar(128),
  "name" varchar(255) NOT NULL,
  "revision" bigint DEFAULT 1 NOT NULL,
  "created_by_actor_id" varchar(128) NOT NULL,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_file_folders_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "company_file_folders_parent_self_check" CHECK ("parent_folder_id" IS NULL OR "parent_folder_id" <> "id")
);
CREATE UNIQUE INDEX "company_file_folders_company_id_unique" ON "company_file_folders" ("company_id","id");
CREATE UNIQUE INDEX "company_file_folders_sibling_name_unique" ON "company_file_folders" ("company_id",coalesce("parent_folder_id",''),"name");
CREATE INDEX "company_file_folders_parent_idx" ON "company_file_folders" ("company_id","parent_folder_id");
ALTER TABLE "company_file_folders" ADD CONSTRAINT "company_file_folders_parent_fk" FOREIGN KEY ("company_id","parent_folder_id") REFERENCES "company_file_folders"("company_id","id") ON DELETE cascade;

CREATE TABLE "company_file_blobs" (
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "object_key" varchar(1024) NOT NULL,
  "created_at_ms" bigint NOT NULL,
  CONSTRAINT "company_file_blobs_company_sha_pk" PRIMARY KEY ("company_id","sha256"),
  CONSTRAINT "company_file_blobs_sha_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "company_file_blobs_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 26214400)
);
CREATE UNIQUE INDEX "company_file_blobs_object_key_unique" ON "company_file_blobs" ("object_key");

CREATE TABLE "company_files" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "folder_id" varchar(128),
  "name" varchar(255) NOT NULL,
  "revision" bigint DEFAULT 1 NOT NULL,
  "current_version_id" varchar(128) NOT NULL,
  "created_by_actor_id" varchar(128) NOT NULL,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_files_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "company_files_company_id_unique" ON "company_files" ("company_id","id");
CREATE UNIQUE INDEX "company_files_sibling_name_unique" ON "company_files" ("company_id",coalesce("folder_id",''),"name");
CREATE INDEX "company_files_folder_idx" ON "company_files" ("company_id","folder_id","updated_at_ms");
ALTER TABLE "company_files" ADD CONSTRAINT "company_files_folder_fk" FOREIGN KEY ("company_id","folder_id") REFERENCES "company_file_folders"("company_id","id") ON DELETE restrict;

CREATE TABLE "company_file_versions" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "file_id" varchar(128) NOT NULL REFERENCES "company_files"("id") ON DELETE cascade,
  "version_number" bigint NOT NULL,
  "blob_sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "mime_type" varchar(255) NOT NULL,
  "original_name" varchar(255) NOT NULL,
  "created_by_actor_id" varchar(128) NOT NULL,
  "created_at_ms" bigint NOT NULL,
  CONSTRAINT "company_file_versions_number_check" CHECK ("version_number" > 0),
  CONSTRAINT "company_file_versions_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 26214400),
  CONSTRAINT "company_file_versions_blob_fk" FOREIGN KEY ("company_id","blob_sha256") REFERENCES "company_file_blobs"("company_id","sha256") ON DELETE restrict
);
CREATE UNIQUE INDEX "company_file_versions_company_id_unique" ON "company_file_versions" ("company_id","id");
CREATE UNIQUE INDEX "company_file_versions_number_unique" ON "company_file_versions" ("file_id","version_number");
CREATE INDEX "company_file_versions_blob_idx" ON "company_file_versions" ("company_id","blob_sha256");
ALTER TABLE "company_files" ADD CONSTRAINT "company_files_current_version_fk" FOREIGN KEY ("company_id","current_version_id") REFERENCES "company_file_versions"("company_id","id") ON DELETE restrict DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE "company_file_uploads" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "requested_by_actor_id" varchar(128) NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "file_id" varchar(128),
  "expected_revision" bigint,
  "folder_id" varchar(128),
  "name" varchar(255) NOT NULL,
  "mime_type" varchar(255) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "object_key" varchar(1024) NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "result_file_id" varchar(128),
  "expires_at_ms" bigint NOT NULL,
  "created_at_ms" bigint NOT NULL,
  "completed_at_ms" bigint,
  CONSTRAINT "company_file_uploads_status_check" CHECK ("status" IN ('pending','completed')),
  CONSTRAINT "company_file_uploads_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 26214400)
);
CREATE UNIQUE INDEX "company_file_uploads_actor_key_unique" ON "company_file_uploads" ("company_id","requested_by_actor_id","idempotency_key");
CREATE INDEX "company_file_uploads_expiry_idx" ON "company_file_uploads" ("status","expires_at_ms");
ALTER TABLE "company_file_uploads" ADD CONSTRAINT "company_file_uploads_file_fk" FOREIGN KEY ("company_id","file_id") REFERENCES "company_files"("company_id","id") ON DELETE cascade;
ALTER TABLE "company_file_uploads" ADD CONSTRAINT "company_file_uploads_folder_fk" FOREIGN KEY ("company_id","folder_id") REFERENCES "company_file_folders"("company_id","id") ON DELETE restrict;
ALTER TABLE "company_file_uploads" ADD CONSTRAINT "company_file_uploads_result_file_fk" FOREIGN KEY ("company_id","result_file_id") REFERENCES "company_files"("company_id","id") ON DELETE cascade;

CREATE TABLE "room_file_references" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "room_id" varchar(128) NOT NULL REFERENCES "rooms"("id") ON DELETE cascade,
  "file_id" varchar(128) NOT NULL REFERENCES "company_files"("id") ON DELETE cascade,
  "created_by_actor_id" varchar(128) NOT NULL,
  "created_at_ms" bigint NOT NULL
);
CREATE UNIQUE INDEX "room_file_references_room_file_unique" ON "room_file_references" ("room_id","file_id");
CREATE INDEX "room_file_references_company_room_idx" ON "room_file_references" ("company_id","room_id");

CREATE TABLE "company_file_mutation_receipts" (
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "actor_id" varchar(128) NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "operation" varchar(64) NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "result" jsonb NOT NULL,
  "created_at_ms" bigint NOT NULL,
  CONSTRAINT "company_file_mutation_receipts_pk" PRIMARY KEY ("company_id","actor_id","idempotency_key")
);

ALTER TABLE "agent_room_executions"
  ADD COLUMN "company_file_inputs_json" jsonb;
