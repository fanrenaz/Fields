ALTER TABLE "company_executors"
  ADD COLUMN "authorization_method" varchar(32) DEFAULT 'chatgpt' NOT NULL;

ALTER TABLE "company_executors"
  ADD COLUMN "endpoint_host" varchar(512);

ALTER TABLE "company_executors"
  ADD CONSTRAINT "company_executors_authorization_method_check"
  CHECK ("authorization_method" IN ('chatgpt', 'custom_api_key'));

ALTER TABLE "company_executors"
  ADD CONSTRAINT "company_executors_authorization_projection_check"
  CHECK (
    ("authorization_method" = 'chatgpt' AND "endpoint_host" IS NULL)
    OR
    (
      "authorization_method" = 'custom_api_key'
      AND "account_id" IS NULL
      AND "plan_type" IS NULL
    )
  );
