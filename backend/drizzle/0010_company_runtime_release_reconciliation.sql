ALTER TABLE "company_runtime_operations"
  ADD COLUMN "release_id" varchar(128),
  ADD COLUMN "runtime_image" varchar(512);
--> statement-breakpoint
ALTER TABLE "company_runtime_operations"
  ADD CONSTRAINT "company_runtime_operations_release_image_check"
  CHECK (
    ("release_id" is null and "runtime_image" is null)
    or ("release_id" is not null and "runtime_image" is not null)
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "company_runtime_operations_release_unique"
  ON "company_runtime_operations" USING btree ("company_id","release_id")
  WHERE "release_id" is not null;
--> statement-breakpoint
CREATE TABLE "company_runtime_release_members" (
  "operation_id" varchar(128) NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "desired_version" bigint NOT NULL,
  "release_id" varchar(128) NOT NULL,
  "member_id" varchar(128) NOT NULL,
  "event_id" varchar(128) NOT NULL,
  "created_at_ms" bigint NOT NULL,
  CONSTRAINT "company_runtime_release_members_desired_version_check"
    CHECK ("desired_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "company_runtime_release_members_identity_unique"
  ON "company_runtime_release_members" USING btree ("operation_id","member_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "company_runtime_release_members_event_unique"
  ON "company_runtime_release_members" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX "company_runtime_release_members_company_idx"
  ON "company_runtime_release_members" USING btree ("company_id","desired_version");
--> statement-breakpoint
ALTER TABLE "company_runtime_release_members"
  ADD CONSTRAINT "company_runtime_release_members_operation_fk"
  FOREIGN KEY ("company_id","operation_id","desired_version")
  REFERENCES "public"."company_runtime_operations"("company_id","operation_id","desired_version")
  ON DELETE cascade;
