CREATE TABLE "company_mailboxes" (
  "mailbox_id" varchar(200) PRIMARY KEY NOT NULL,
  "company_id" varchar(100) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "kind" varchar(20) NOT NULL,
  "target_actor_id" varchar(100) REFERENCES "actors"("id") ON DELETE cascade,
  "display_name" varchar(200),
  "email_address" varchar(320),
  "connection_state" varchar(30) DEFAULT 'unconnected' NOT NULL,
  "credential_version" bigint DEFAULT 0 NOT NULL,
  "capability_folders" boolean DEFAULT false NOT NULL,
  "capability_search" boolean DEFAULT false NOT NULL,
  "capability_flags" boolean DEFAULT false NOT NULL,
  "capability_move" boolean DEFAULT false NOT NULL,
  "capability_trash" boolean DEFAULT false NOT NULL,
  "capability_append_sent" boolean DEFAULT false NOT NULL,
  "last_checked_at_ms" bigint,
  "last_error_code" varchar(120),
  "created_by_actor_id" varchar(100) NOT NULL REFERENCES "actors"("id"),
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_mailboxes_kind_check" CHECK ("kind" in ('personal', 'shared')),
  CONSTRAINT "company_mailboxes_target_check" CHECK (
    ("kind" = 'personal' and "target_actor_id" is not null)
    or ("kind" = 'shared' and "target_actor_id" is null)
  ),
  CONSTRAINT "company_mailboxes_connection_state_check" CHECK (
    "connection_state" in ('unconnected', 'validating', 'connected', 'limited', 'error')
  ),
  CONSTRAINT "company_mailboxes_credential_version_check" CHECK ("credential_version" >= 0)
);
CREATE UNIQUE INDEX "company_mailboxes_personal_actor_unique"
  ON "company_mailboxes" ("company_id", "target_actor_id") WHERE "kind" = 'personal';
CREATE INDEX "company_mailboxes_company_kind_idx"
  ON "company_mailboxes" ("company_id", "kind");

CREATE TABLE "company_mailbox_grants" (
  "company_id" varchar(100) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "mailbox_id" varchar(200) NOT NULL REFERENCES "company_mailboxes"("mailbox_id") ON DELETE cascade,
  "actor_id" varchar(100) NOT NULL REFERENCES "actors"("id") ON DELETE cascade,
  "granted_by_actor_id" varchar(100) NOT NULL REFERENCES "actors"("id"),
  "granted_at_ms" bigint NOT NULL,
  CONSTRAINT "company_mailbox_grants_pk" PRIMARY KEY ("mailbox_id", "actor_id")
);
CREATE INDEX "company_mailbox_grants_company_actor_idx"
  ON "company_mailbox_grants" ("company_id", "actor_id");

CREATE TABLE "company_mailbox_mutation_receipts" (
  "company_id" varchar(100) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "actor_id" varchar(100) NOT NULL REFERENCES "actors"("id") ON DELETE cascade,
  "idempotency_key" varchar(200) NOT NULL,
  "operation" varchar(80) NOT NULL,
  "operation_id" varchar(200) NOT NULL,
  "mailbox_id" varchar(200) NOT NULL REFERENCES "company_mailboxes"("mailbox_id") ON DELETE cascade,
  "expected_credential_version" bigint NOT NULL,
  "credential_version" bigint NOT NULL,
  "previous_mailbox_json" text,
  "request_fingerprint" varchar(64) NOT NULL,
  "result_json" text,
  "created_at_ms" bigint NOT NULL,
  CONSTRAINT "company_mailbox_mutation_receipts_version_check" CHECK (
    "expected_credential_version" >= 0
    and "credential_version" = "expected_credential_version" + 1
  ),
  CONSTRAINT "company_mailbox_mutation_receipts_pk"
    PRIMARY KEY ("company_id", "actor_id", "idempotency_key")
);
CREATE UNIQUE INDEX "company_mailbox_mutation_receipts_pending_mailbox_unique"
  ON "company_mailbox_mutation_receipts" ("company_id", "mailbox_id")
  WHERE "result_json" is null;

CREATE TABLE "company_mailbox_audit_events" (
  "audit_event_id" varchar(100) PRIMARY KEY NOT NULL,
  "company_id" varchar(100) NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "mailbox_id" varchar(200),
  "actor_id" varchar(100) NOT NULL REFERENCES "actors"("id"),
  "operation" varchar(80) NOT NULL,
  "item_count" bigint DEFAULT 0 NOT NULL,
  "size_bytes" bigint DEFAULT 0 NOT NULL,
  "outcome" varchar(80) NOT NULL,
  "created_at_ms" bigint NOT NULL,
  CONSTRAINT "company_mailbox_audit_item_count_check" CHECK ("item_count" >= 0),
  CONSTRAINT "company_mailbox_audit_size_check" CHECK ("size_bytes" >= 0)
);
CREATE INDEX "company_mailbox_audit_company_time_idx"
  ON "company_mailbox_audit_events" ("company_id", "created_at_ms");
