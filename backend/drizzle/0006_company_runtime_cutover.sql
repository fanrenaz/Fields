-- Intentional destructive cutover. The retired Company Home, Room Sandbox,
-- Room binding, and per-surface Executor assignments are not migrated or
-- dual-written into the Company Runtime model.

DROP TABLE IF EXISTS "room_actor_bindings" CASCADE;
DROP TABLE IF EXISTS "room_runtime_presences" CASCADE;
DROP TABLE IF EXISTS "room_sandbox_operations" CASCADE;
DROP TABLE IF EXISTS "room_sandbox_instances" CASCADE;
DROP TABLE IF EXISTS "room_sandbox_leases" CASCADE;
DROP TABLE IF EXISTS "room_sandbox_runtimes" CASCADE;
DROP TABLE IF EXISTS "room_sandbox_workspaces" CASCADE;

DROP TABLE IF EXISTS "home_agent_executor_assignments" CASCADE;
DROP TABLE IF EXISTS "human_room_executor_preferences" CASCADE;
DROP TABLE IF EXISTS "executor_auth_attempts" CASCADE;

ALTER TABLE "room_memberships"
  DROP COLUMN IF EXISTS "executor_id" CASCADE;

DROP TABLE IF EXISTS "company_executors" CASCADE;
DROP TABLE IF EXISTS "company_home_leases" CASCADE;
DROP TABLE IF EXISTS "company_home_instances" CASCADE;
DROP TABLE IF EXISTS "company_home_operations" CASCADE;
DROP TABLE IF EXISTS "company_home_workspaces" CASCADE;

DROP TABLE IF EXISTS "company_onboarding_processes" CASCADE;

-- Paired Home Agents are retired facts, not Company Members to preserve.
DELETE FROM "actors"
WHERE "home_human_actor_id" IS NOT NULL;

ALTER TABLE "actors"
  DROP COLUMN IF EXISTS "home_human_actor_id" CASCADE;

ALTER TABLE "rooms"
  ADD COLUMN "next_message_sequence" bigint NOT NULL DEFAULT 1;
ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_next_message_sequence_check"
  CHECK ("next_message_sequence" > 0);
CREATE UNIQUE INDEX "rooms_room_company_unique"
  ON "rooms" ("id", "company_id");

CREATE TABLE "company_onboarding_processes" (
  "company_id" varchar(128) PRIMARY KEY,
  "owner_actor_id" varchar(128) NOT NULL,
  "runtime_id" varchar(128) NOT NULL,
  "executor_id" varchar(128),
  "initial_operation_id" varchar(128) NOT NULL,
  "stage" varchar(32) NOT NULL DEFAULT 'creatingRuntime',
  "version" bigint NOT NULL DEFAULT 0,
  "last_error_code" varchar(128),
  "last_error_retryable" boolean,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_onboarding_processes_company_id_companies_id_fk"
    FOREIGN KEY ("company_id")
    REFERENCES "companies"("id") ON DELETE CASCADE,
  CONSTRAINT "company_onboarding_processes_stage_check"
    CHECK ("stage" IN ('creatingRuntime', 'initializingRuntime', 'failed', 'ready')),
  CONSTRAINT "company_onboarding_processes_version_check"
    CHECK ("version" >= 0)
);
CREATE INDEX "company_onboarding_processes_stage_idx"
  ON "company_onboarding_processes" ("stage", "updated_at_ms");

CREATE TABLE "company_runtime_workspaces" (
  "company_id" varchar(128) PRIMARY KEY,
  "provider" varchar(32) NOT NULL DEFAULT 'docker-volume',
  "resource_name" varchar(255) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "last_error_code" varchar(128),
  "last_error_retryable" boolean,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_runtime_workspaces_company_id_companies_id_fk"
    FOREIGN KEY ("company_id")
    REFERENCES "companies"("id") ON DELETE CASCADE,
  CONSTRAINT "company_runtime_workspaces_status_check"
    CHECK ("status" IN ('pending', 'provisioning', 'initializing', 'ready', 'failed'))
);
CREATE UNIQUE INDEX "company_runtime_workspaces_resource_name_unique"
  ON "company_runtime_workspaces" ("resource_name");

CREATE TABLE "company_runtime_operations" (
  "operation_id" varchar(128) PRIMARY KEY,
  "company_id" varchar(128) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "desired_version" bigint NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "attempt" bigint NOT NULL DEFAULT 0,
  "claimed_by" varchar(128),
  "claim_token" varchar(128),
  "claimed_until_ms" bigint,
  "next_attempt_at_ms" bigint NOT NULL,
  "last_error_code" varchar(128),
  "last_error_retryable" boolean,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_runtime_operations_workspace_fk"
    FOREIGN KEY ("company_id")
    REFERENCES "company_runtime_workspaces"("company_id") ON DELETE CASCADE,
  CONSTRAINT "company_runtime_operations_desired_version_check"
    CHECK ("desired_version" > 0),
  CONSTRAINT "company_runtime_operations_kind_check"
    CHECK ("kind" IN ('provision', 'retry', 'replace', 'stop')),
  CONSTRAINT "company_runtime_operations_status_check"
    CHECK ("status" IN ('pending', 'claimed', 'succeeded', 'failed'))
);
CREATE INDEX "company_runtime_operations_claim_idx"
  ON "company_runtime_operations" ("status", "next_attempt_at_ms", "claimed_until_ms");
CREATE INDEX "company_runtime_operations_company_id_idx"
  ON "company_runtime_operations" ("company_id");
CREATE UNIQUE INDEX "company_runtime_operations_desired_version_unique"
  ON "company_runtime_operations" ("company_id", "desired_version");
CREATE UNIQUE INDEX "company_runtime_operations_identity_unique"
  ON "company_runtime_operations" ("company_id", "operation_id", "desired_version");

CREATE TABLE "company_runtime_instances" (
  "instance_id" varchar(128) PRIMARY KEY,
  "company_id" varchar(128) NOT NULL,
  "generation" bigint NOT NULL,
  "source_operation_id" varchar(128) NOT NULL,
  "desired_version" bigint NOT NULL,
  "provider" varchar(32) NOT NULL DEFAULT 'docker',
  "runtime_url" varchar(2048),
  "container_id" varchar(128),
  "container_name" varchar(255) NOT NULL,
  "volume_name" varchar(255) NOT NULL,
  "image" varchar(512) NOT NULL,
  "template_hash" varchar(128) NOT NULL,
  "observed_state" varchar(32) NOT NULL DEFAULT 'pending',
  "last_heartbeat_at_ms" bigint,
  "last_error_code" varchar(128),
  "last_error_retryable" boolean,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_runtime_instances_workspace_fk"
    FOREIGN KEY ("company_id")
    REFERENCES "company_runtime_workspaces"("company_id") ON DELETE CASCADE,
  CONSTRAINT "company_runtime_instances_generation_check"
    CHECK ("generation" > 0),
  CONSTRAINT "company_runtime_instances_desired_version_check"
    CHECK ("desired_version" > 0),
  CONSTRAINT "company_runtime_instances_observed_state_check"
    CHECK ("observed_state" IN ('pending', 'starting', 'ready', 'stopping', 'stopped', 'failed')),
  CONSTRAINT "company_runtime_instances_source_operation_fk"
    FOREIGN KEY ("company_id", "source_operation_id", "desired_version")
    REFERENCES "company_runtime_operations"("company_id", "operation_id", "desired_version")
    ON DELETE RESTRICT
);
CREATE INDEX "company_runtime_instances_company_id_idx"
  ON "company_runtime_instances" ("company_id");
CREATE UNIQUE INDEX "company_runtime_instances_generation_unique"
  ON "company_runtime_instances" ("company_id", "generation");
CREATE UNIQUE INDEX "company_runtime_instances_identity_unique"
  ON "company_runtime_instances" ("company_id", "instance_id", "generation");
CREATE UNIQUE INDEX "company_runtime_instances_desired_version_unique"
  ON "company_runtime_instances" ("company_id", "desired_version");
CREATE UNIQUE INDEX "company_runtime_instances_container_name_unique"
  ON "company_runtime_instances" ("container_name");

CREATE TABLE "company_runtime_leases" (
  "company_id" varchar(128) PRIMARY KEY,
  "instance_id" varchar(128) NOT NULL,
  "generation" bigint NOT NULL,
  "lease_id" varchar(128) NOT NULL,
  "callback_token_hash" varchar(128) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'provisioning',
  "last_heartbeat_at_ms" bigint,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_runtime_leases_runtime_identity_fk"
    FOREIGN KEY ("company_id", "instance_id", "generation")
    REFERENCES "company_runtime_instances"("company_id", "instance_id", "generation")
    ON DELETE CASCADE,
  CONSTRAINT "company_runtime_leases_status_check"
    CHECK ("status" IN ('provisioning', 'initializing', 'ready', 'failed', 'expired'))
);
CREATE UNIQUE INDEX "company_runtime_leases_instance_id_unique"
  ON "company_runtime_leases" ("instance_id");
CREATE UNIQUE INDEX "company_runtime_leases_lease_id_unique"
  ON "company_runtime_leases" ("lease_id");
CREATE UNIQUE INDEX "company_runtime_leases_callback_hash_unique"
  ON "company_runtime_leases" ("callback_token_hash");

CREATE TABLE "agent_member_cleanup_operations" (
  "operation_id" varchar(128) PRIMARY KEY,
  "company_id" varchar(128) NOT NULL,
  "member_id" varchar(128) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "attempt" bigint NOT NULL DEFAULT 0,
  "last_error_code" varchar(128),
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  "completed_at_ms" bigint,
  CONSTRAINT "agent_member_cleanup_operations_status_check"
    CHECK ("status" IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT "agent_member_cleanup_operations_actor_fk"
    FOREIGN KEY ("company_id", "member_id")
    REFERENCES "actors"("company_id", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "agent_member_cleanup_operations_member_unique"
  ON "agent_member_cleanup_operations" ("company_id", "member_id");

CREATE TABLE "company_runtime_presences" (
  "company_id" varchar(128) PRIMARY KEY,
  "instance_id" varchar(128) NOT NULL,
  "generation" bigint NOT NULL,
  "active_member_server_count" bigint NOT NULL DEFAULT 0,
  "active_execution_count" bigint NOT NULL DEFAULT 0,
  "status_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "observed_at_ms" bigint NOT NULL,
  CONSTRAINT "company_runtime_presences_runtime_identity_fk"
    FOREIGN KEY ("company_id", "instance_id", "generation")
    REFERENCES "company_runtime_instances"("company_id", "instance_id", "generation")
    ON DELETE CASCADE,
  CONSTRAINT "company_runtime_presences_counts_check"
    CHECK ("active_member_server_count" >= 0 AND "active_execution_count" >= 0)
);

CREATE TABLE "company_executors" (
  "executor_id" varchar(128) PRIMARY KEY,
  "company_id" varchar(128) NOT NULL,
  "owner_member_id" varchar(128) NOT NULL,
  "name" varchar(255) NOT NULL,
  "sharing_state" varchar(32) NOT NULL DEFAULT 'private',
  "status" varchar(32) NOT NULL DEFAULT 'pending_auth',
  "account_id" varchar(255),
  "plan_type" varchar(128),
  "credential_version" bigint NOT NULL DEFAULT 0,
  "connected_at_ms" bigint,
  "expires_at_ms" bigint,
  "revoked_at_ms" bigint,
  "last_error_code" varchar(128),
  "last_error_retryable" boolean,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "company_executors_company_id_fk"
    FOREIGN KEY ("company_id")
    REFERENCES "companies"("id") ON DELETE CASCADE,
  CONSTRAINT "company_executors_owner_member_fk"
    FOREIGN KEY ("company_id", "owner_member_id")
    REFERENCES "actors"("company_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "company_executors_sharing_state_check"
    CHECK ("sharing_state" IN ('private', 'company_shared', 'admin_blocked')),
  CONSTRAINT "company_executors_credential_version_check"
    CHECK ("credential_version" >= 0),
  CONSTRAINT "company_executors_status_check"
    CHECK ("status" IN ('pending_auth', 'connected', 'expired', 'revoked', 'failed'))
);
CREATE UNIQUE INDEX "company_executors_company_executor_unique"
  ON "company_executors" ("company_id", "executor_id");
CREATE UNIQUE INDEX "company_executors_owner_name_unique"
  ON "company_executors" ("company_id", "owner_member_id", "name");
CREATE UNIQUE INDEX "company_executors_company_account_unique"
  ON "company_executors" ("company_id", "account_id")
  WHERE "account_id" IS NOT NULL;

CREATE TABLE "member_executor_assignments" (
  "member_id" varchar(128) PRIMARY KEY,
  "company_id" varchar(128) NOT NULL,
  "executor_id" varchar(128) NOT NULL,
  "pending_executor_id" varchar(128),
  "previous_executor_id" varchar(128),
  "assignment_version" bigint NOT NULL DEFAULT 1,
  "state" varchar(32) NOT NULL DEFAULT 'ready',
  "switch_operation_id" varchar(128),
  "last_error_code" varchar(128),
  "last_error_retryable" boolean,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "member_executor_assignments_member_fk"
    FOREIGN KEY ("company_id", "member_id")
    REFERENCES "actors"("company_id", "id") ON DELETE CASCADE,
  CONSTRAINT "member_executor_assignments_executor_fk"
    FOREIGN KEY ("company_id", "executor_id")
    REFERENCES "company_executors"("company_id", "executor_id") ON DELETE RESTRICT,
  CONSTRAINT "member_executor_assignments_pending_executor_fk"
    FOREIGN KEY ("company_id", "pending_executor_id")
    REFERENCES "company_executors"("company_id", "executor_id") ON DELETE RESTRICT,
  CONSTRAINT "member_executor_assignments_previous_executor_fk"
    FOREIGN KEY ("company_id", "previous_executor_id")
    REFERENCES "company_executors"("company_id", "executor_id") ON DELETE RESTRICT,
  CONSTRAINT "member_executor_assignments_version_check"
    CHECK ("assignment_version" > 0),
  CONSTRAINT "member_executor_assignments_state_check"
    CHECK ("state" IN ('ready', 'switching', 'auth_required', 'failed')),
  CONSTRAINT "member_executor_assignments_switch_shape_check"
    CHECK (
      ("state" = 'switching'
        AND "pending_executor_id" IS NOT NULL
        AND "previous_executor_id" IS NOT NULL
        AND "switch_operation_id" IS NOT NULL)
      OR
      ("state" <> 'switching'
        AND "pending_executor_id" IS NULL
        AND "previous_executor_id" IS NULL
        AND "switch_operation_id" IS NULL)
    )
);
CREATE INDEX "member_executor_assignments_company_id_idx"
  ON "member_executor_assignments" ("company_id");
CREATE UNIQUE INDEX "member_executor_assignments_switch_operation_unique"
  ON "member_executor_assignments" ("switch_operation_id")
  WHERE "switch_operation_id" IS NOT NULL;

CREATE TABLE "executor_auth_attempts" (
  "attempt_id" varchar(128) PRIMARY KEY,
  "company_id" varchar(128) NOT NULL,
  "executor_id" varchar(128) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "last_error_code" varchar(128),
  "last_error_retryable" boolean,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "executor_auth_attempts_company_executor_fk"
    FOREIGN KEY ("company_id", "executor_id")
    REFERENCES "company_executors"("company_id", "executor_id") ON DELETE CASCADE,
  CONSTRAINT "executor_auth_attempts_status_check"
    CHECK ("status" IN ('pending', 'completed', 'cancelled', 'failed'))
);
CREATE INDEX "executor_auth_attempts_company_id_idx"
  ON "executor_auth_attempts" ("company_id");
CREATE INDEX "executor_auth_attempts_executor_id_idx"
  ON "executor_auth_attempts" ("executor_id");
CREATE UNIQUE INDEX "executor_auth_attempts_pending_unique"
  ON "executor_auth_attempts" ("executor_id")
  WHERE "status" = 'pending';

CREATE TABLE "room_messages" (
  "message_id" varchar(128) PRIMARY KEY,
  "room_id" varchar(128) NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "sequence" bigint NOT NULL,
  "sender_member_id" varchar(128),
  "sender_type" varchar(32) NOT NULL,
  "client_message_id" varchar(128),
  "markdown" text NOT NULL,
  "plain_text" text NOT NULL,
  "reply_to_message_ids_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "references_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "thread_id" varchar(128),
  "trigger_message_id" varchar(128),
  "source_execution_id" varchar(128),
  "source_cascade_id" varchar(128),
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  CONSTRAINT "room_messages_room_fk"
    FOREIGN KEY ("room_id", "company_id")
    REFERENCES "rooms"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "room_messages_sender_member_fk"
    FOREIGN KEY ("company_id", "sender_member_id")
    REFERENCES "actors"("company_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "room_messages_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "room_messages_sender_type_check"
    CHECK ("sender_type" IN ('human', 'agent', 'system')),
  CONSTRAINT "room_messages_sender_shape_check"
    CHECK (
      ("sender_type" = 'system' AND "sender_member_id" IS NULL)
      OR ("sender_type" <> 'system' AND "sender_member_id" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX "room_messages_room_sequence_unique"
  ON "room_messages" ("room_id", "sequence");
CREATE UNIQUE INDEX "room_messages_client_idempotency_unique"
  ON "room_messages" ("room_id", "sender_member_id", "client_message_id")
  WHERE "client_message_id" IS NOT NULL;
CREATE INDEX "room_messages_room_created_idx"
  ON "room_messages" ("room_id", "created_at_ms");
CREATE INDEX "room_messages_plain_text_idx"
  ON "room_messages" ("room_id", "sequence");

CREATE TABLE "agent_room_states" (
  "room_id" varchar(128) NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "agent_member_id" varchar(128) NOT NULL,
  "trigger_policy" varchar(32) NOT NULL DEFAULT 'human_explicit',
  "trigger_policy_version" bigint NOT NULL DEFAULT 1,
  "thread_id" varchar(128),
  "cursor_sequence" bigint NOT NULL DEFAULT 0,
  "eligible_from_sequence" bigint NOT NULL DEFAULT 1,
  "membership_active" boolean NOT NULL DEFAULT true,
  "membership_version" bigint NOT NULL,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  PRIMARY KEY ("room_id", "agent_member_id"),
  CONSTRAINT "agent_room_states_room_fk"
    FOREIGN KEY ("room_id", "company_id")
    REFERENCES "rooms"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_states_agent_member_fk"
    FOREIGN KEY ("company_id", "agent_member_id")
    REFERENCES "actors"("company_id", "id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_states_trigger_policy_check"
    CHECK ("trigger_policy" IN ('human_explicit', 'member_explicit', 'human_auto', 'member_auto')),
  CONSTRAINT "agent_room_states_cursor_check"
    CHECK ("cursor_sequence" >= 0 AND "eligible_from_sequence" > 0),
  CONSTRAINT "agent_room_states_trigger_policy_version_check"
    CHECK ("trigger_policy_version" > 0),
  CONSTRAINT "agent_room_states_membership_version_check"
    CHECK ("membership_version" > 0)
);
CREATE UNIQUE INDEX "agent_room_states_thread_unique"
  ON "agent_room_states" ("company_id", "thread_id")
  WHERE "thread_id" IS NOT NULL;
CREATE INDEX "agent_room_states_agent_idx"
  ON "agent_room_states" ("company_id", "agent_member_id");

CREATE TABLE "agent_room_cascades" (
  "cascade_id" varchar(128) PRIMARY KEY,
  "room_id" varchar(128) NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "source_message_id" varchar(128) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'active',
  "created_at_ms" bigint NOT NULL,
  "completed_at_ms" bigint,
  CONSTRAINT "agent_room_cascades_source_message_fk"
    FOREIGN KEY ("source_message_id")
    REFERENCES "room_messages"("message_id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_cascades_room_fk"
    FOREIGN KEY ("room_id", "company_id")
    REFERENCES "rooms"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_cascades_status_check"
    CHECK ("status" IN ('active', 'silent_completed', 'failed'))
);
CREATE INDEX "agent_room_cascades_room_status_idx"
  ON "agent_room_cascades" ("room_id", "status");

CREATE TABLE "agent_room_executions" (
  "execution_id" varchar(128) PRIMARY KEY,
  "room_id" varchar(128) NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "agent_member_id" varchar(128) NOT NULL,
  "cascade_id" varchar(128) NOT NULL,
  "source_message_id" varchar(128) NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "trigger" varchar(32) NOT NULL,
  "trigger_policy" varchar(32) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "from_sequence" bigint NOT NULL,
  "through_sequence" bigint NOT NULL,
  "thread_id" varchar(128),
  "attempt" bigint NOT NULL DEFAULT 0,
  "published_message_count" bigint NOT NULL DEFAULT 0,
  "last_error_code" varchar(128),
  "last_error_retryable" boolean,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  "started_at_ms" bigint,
  "completed_at_ms" bigint,
  CONSTRAINT "agent_room_executions_cascade_fk"
    FOREIGN KEY ("cascade_id")
    REFERENCES "agent_room_cascades"("cascade_id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_executions_source_message_fk"
    FOREIGN KEY ("source_message_id")
    REFERENCES "room_messages"("message_id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_executions_room_fk"
    FOREIGN KEY ("room_id", "company_id")
    REFERENCES "rooms"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_executions_agent_member_fk"
    FOREIGN KEY ("company_id", "agent_member_id")
    REFERENCES "actors"("company_id", "id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_executions_trigger_policy_check"
    CHECK ("trigger_policy" IN ('human_explicit', 'member_explicit', 'human_auto', 'member_auto')),
  CONSTRAINT "agent_room_executions_trigger_check"
    CHECK ("trigger" IN ('mention', 'direct_reply', 'automatic')),
  CONSTRAINT "agent_room_executions_status_check"
    CHECK ("status" IN ('pending', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT "agent_room_executions_sequence_check"
    CHECK ("from_sequence" > 0 AND "through_sequence" >= "from_sequence"),
  CONSTRAINT "agent_room_executions_counts_check"
    CHECK ("attempt" >= 0 AND "published_message_count" >= 0)
);
CREATE UNIQUE INDEX "agent_room_executions_idempotency_unique"
  ON "agent_room_executions" ("idempotency_key");
CREATE INDEX "agent_room_executions_dispatch_idx"
  ON "agent_room_executions" ("status", "created_at_ms");
CREATE INDEX "agent_room_executions_agent_room_idx"
  ON "agent_room_executions" ("room_id", "agent_member_id", "created_at_ms");

CREATE TABLE "agent_room_execution_messages" (
  "execution_id" varchar(128) NOT NULL,
  "message_id" varchar(128) NOT NULL,
  "sequence" bigint NOT NULL,
  PRIMARY KEY ("execution_id", "message_id"),
  CONSTRAINT "agent_room_execution_messages_execution_fk"
    FOREIGN KEY ("execution_id")
    REFERENCES "agent_room_executions"("execution_id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_execution_messages_message_fk"
    FOREIGN KEY ("message_id")
    REFERENCES "room_messages"("message_id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_execution_messages_sequence_check"
    CHECK ("sequence" > 0)
);
CREATE UNIQUE INDEX "agent_room_execution_messages_sequence_unique"
  ON "agent_room_execution_messages" ("execution_id", "sequence");

ALTER TABLE "room_messages"
  ADD CONSTRAINT "room_messages_trigger_message_fk"
  FOREIGN KEY ("trigger_message_id")
  REFERENCES "room_messages"("message_id") ON DELETE SET NULL;
ALTER TABLE "room_messages"
  ADD CONSTRAINT "room_messages_source_execution_id_agent_room_executions_execution_id_fk"
  FOREIGN KEY ("source_execution_id")
  REFERENCES "agent_room_executions"("execution_id") ON DELETE SET NULL;
ALTER TABLE "room_messages"
  ADD CONSTRAINT "room_messages_source_cascade_id_agent_room_cascades_cascade_id_fk"
  FOREIGN KEY ("source_cascade_id")
  REFERENCES "agent_room_cascades"("cascade_id") ON DELETE SET NULL;

-- Runtime provider envelopes are projected transiently. These tables retain
-- only provider-neutral snapshots, receipt identifiers, and interaction facts.
CREATE TABLE "agent_room_activity_receipts" (
  "event_id" varchar(255) PRIMARY KEY,
  "execution_id" varchar(128) NOT NULL,
  "interaction_id" varchar(128),
  "occurred_at_ms" bigint NOT NULL,
  "created_at_ms" bigint NOT NULL,
  CONSTRAINT "agent_room_activity_receipts_execution_id_agent_room_executions_execution_id_fk"
    FOREIGN KEY ("execution_id")
    REFERENCES "agent_room_executions"("execution_id") ON DELETE CASCADE
);
CREATE INDEX "agent_room_activity_receipts_execution_idx"
  ON "agent_room_activity_receipts" ("execution_id", "created_at_ms");

CREATE TABLE "agent_room_activity_snapshots" (
  "execution_id" varchar(128) NOT NULL,
  "sequence" bigint NOT NULL,
  "event_id" varchar(255) NOT NULL,
  "snapshot_json" jsonb NOT NULL,
  "occurred_at_ms" bigint NOT NULL,
  PRIMARY KEY ("execution_id", "sequence"),
  CONSTRAINT "agent_room_activity_snapshots_execution_id_agent_room_executions_execution_id_fk"
    FOREIGN KEY ("execution_id")
    REFERENCES "agent_room_executions"("execution_id") ON DELETE CASCADE,
  CONSTRAINT "agent_room_activity_snapshots_sequence_check"
    CHECK ("sequence" > 0)
);
CREATE UNIQUE INDEX "agent_room_activity_snapshots_event_unique"
  ON "agent_room_activity_snapshots" ("event_id");

CREATE TABLE "room_interactions" (
  "interaction_id" varchar(128) PRIMARY KEY,
  "room_id" varchar(128) NOT NULL,
  "company_id" varchar(128) NOT NULL,
  "execution_id" varchar(128) NOT NULL,
  "agent_member_id" varchar(128) NOT NULL,
  "message_id" varchar(128) NOT NULL,
  "kind" varchar(32) NOT NULL DEFAULT 'delegation_check',
  "label" varchar(500) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "responses_json" jsonb NOT NULL,
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  "responded_at_ms" bigint,
  CONSTRAINT "room_interactions_execution_id_agent_room_executions_execution_id_fk"
    FOREIGN KEY ("execution_id")
    REFERENCES "agent_room_executions"("execution_id") ON DELETE CASCADE,
  CONSTRAINT "room_interactions_message_id_room_messages_message_id_fk"
    FOREIGN KEY ("message_id")
    REFERENCES "room_messages"("message_id") ON DELETE CASCADE,
  CONSTRAINT "room_interactions_room_fk"
    FOREIGN KEY ("room_id", "company_id")
    REFERENCES "rooms"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "room_interactions_agent_fk"
    FOREIGN KEY ("company_id", "agent_member_id")
    REFERENCES "actors"("company_id", "id") ON DELETE CASCADE,
  CONSTRAINT "room_interactions_kind_check"
    CHECK ("kind" = 'delegation_check'),
  CONSTRAINT "room_interactions_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected'))
);
ALTER TABLE "agent_room_activity_receipts"
  ADD CONSTRAINT "agent_room_activity_receipts_interaction_id_room_interactions_interaction_id_fk"
  FOREIGN KEY ("interaction_id")
  REFERENCES "room_interactions"("interaction_id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "room_interactions_message_unique"
  ON "room_interactions" ("message_id");
CREATE INDEX "room_interactions_execution_idx"
  ON "room_interactions" ("execution_id", "created_at_ms");

CREATE TABLE "room_interaction_responses" (
  "persisted_response_id" varchar(128) PRIMARY KEY,
  "interaction_id" varchar(128) NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "client_response_id" varchar(128),
  "responder_member_id" varchar(128) NOT NULL,
  "response" varchar(32) NOT NULL,
  "delivery_status" varchar(32) NOT NULL DEFAULT 'pending',
  "runtime_duplicate" boolean,
  "responded_at_ms" bigint NOT NULL,
  "delivered_at_ms" bigint,
  CONSTRAINT "room_interaction_responses_interaction_id_room_interactions_interaction_id_fk"
    FOREIGN KEY ("interaction_id")
    REFERENCES "room_interactions"("interaction_id") ON DELETE CASCADE,
  CONSTRAINT "room_interaction_responses_response_check"
    CHECK ("response" IN ('approve', 'reject')),
  CONSTRAINT "room_interaction_responses_delivery_status_check"
    CHECK ("delivery_status" IN ('pending', 'delivered'))
);
CREATE UNIQUE INDEX "room_interaction_responses_idempotency_unique"
  ON "room_interaction_responses" ("idempotency_key");
CREATE UNIQUE INDEX "room_interaction_responses_client_unique"
  ON "room_interaction_responses" ("interaction_id", "responder_member_id", "client_response_id")
  WHERE "client_response_id" IS NOT NULL;
