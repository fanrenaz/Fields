CREATE TABLE "company_registration_settings" (
  "company_id" varchar(128) PRIMARY KEY NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "code" varchar(128) NOT NULL,
  "code_version" bigint DEFAULT 1 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "updated_by_actor_id" varchar(128),
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_registration_settings_code_version_check" CHECK ("code_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "registration_signup_grants" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "company_id" varchar(128) NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "credential_hash" varchar(128) NOT NULL,
  "normalized_email" text NOT NULL,
  "code_version" bigint NOT NULL,
  "status" varchar(32) DEFAULT 'prepared' NOT NULL,
  "expires_at_ms" bigint NOT NULL,
  "claimed_at_ms" bigint,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "registration_signup_grants_code_version_check" CHECK ("code_version" > 0),
  CONSTRAINT "registration_signup_grants_status_check" CHECK ("status" in ('prepared', 'claimed'))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "registration_grant_id" varchar(128);
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_registration_grant_id_fk"
  FOREIGN KEY ("registration_grant_id") REFERENCES "registration_signup_grants"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_registration_grant_id_unique" ON "user" ("registration_grant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "registration_signup_grants_credential_hash_unique" ON "registration_signup_grants" ("credential_hash");
--> statement-breakpoint
CREATE INDEX "registration_signup_grants_company_status_idx" ON "registration_signup_grants" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX "registration_signup_grants_expiry_idx" ON "registration_signup_grants" ("expires_at_ms");
