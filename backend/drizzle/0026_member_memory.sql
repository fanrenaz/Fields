CREATE TABLE "member_memory_profiles" (
  "company_id" varchar(128) NOT NULL,
  "member_id" varchar(128) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "applied_enabled" boolean DEFAULT true NOT NULL,
  "status" varchar(32) DEFAULT 'ready' NOT NULL,
  "error_code" varchar(128),
  "operation_id" varchar(128),
  "revision" bigint DEFAULT 0 NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "member_memory_profiles_company_member_unique" UNIQUE("company_id", "member_id"),
  CONSTRAINT "member_memory_profiles_member_fk" FOREIGN KEY ("company_id", "member_id")
    REFERENCES "actors"("company_id", "id") ON DELETE cascade,
  CONSTRAINT "member_memory_profiles_status_check" CHECK ("status" IN ('ready', 'applying', 'failed'))
);
