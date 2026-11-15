CREATE TABLE "company_devices" (
	"device_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"label" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"current_token_hash" varchar(128) NOT NULL,
	"current_token_version" bigint DEFAULT 1 NOT NULL,
	"pending_token_hash" varchar(128),
	"pending_token_version" bigint,
	"created_at_ms" bigint NOT NULL,
	"paired_at_ms" bigint NOT NULL,
	"revoked_at_ms" bigint,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "company_devices_status_check" CHECK ("company_devices"."status" in ('active', 'revoked')),
	CONSTRAINT "company_devices_current_token_version_check" CHECK ("company_devices"."current_token_version" > 0),
	CONSTRAINT "company_devices_pending_token_shape_check" CHECK ((
    ("company_devices"."pending_token_hash" is null and "company_devices"."pending_token_version" is null)
    or ("company_devices"."pending_token_hash" is not null and "company_devices"."pending_token_version" is not null and "company_devices"."pending_token_version" > "company_devices"."current_token_version")
  ))
);
--> statement-breakpoint
ALTER TABLE "company_devices" ADD CONSTRAINT "company_devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_devices_company_id_idx" ON "company_devices" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_devices_active_company_idx" ON "company_devices" USING btree ("company_id","status");