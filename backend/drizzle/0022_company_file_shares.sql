CREATE TABLE "company_file_shares" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "file_id" varchar(128) NOT NULL REFERENCES "company_files"("id") ON DELETE cascade,
  "created_by_actor_id" varchar(128) NOT NULL,
  "created_at_ms" bigint NOT NULL,
  "expires_at_ms" bigint,
  "revoked_at_ms" bigint,
  CONSTRAINT "company_file_shares_expiry_check" CHECK ("expires_at_ms" IS NULL OR "expires_at_ms" > "created_at_ms")
);
CREATE UNIQUE INDEX "company_file_shares_company_id_unique" ON "company_file_shares" ("company_id","id");
CREATE INDEX "company_file_shares_owner_file_idx" ON "company_file_shares" ("company_id","created_by_actor_id","file_id","created_at_ms");
CREATE INDEX "company_file_shares_expiry_idx" ON "company_file_shares" ("expires_at_ms");
