CREATE TABLE "actors" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"type" varchar(32) DEFAULT 'human' NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"mark" varchar(32) NOT NULL,
	"company_role" varchar(32) DEFAULT 'member' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"auth_user_id" text,
	"home_human_actor_id" varchar(128),
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "actors_home_agent_shape_check" CHECK ("actors"."home_human_actor_id" is null or (
      "actors"."type" = 'agent'
      and "actors"."auth_user_id" is null
      and "actors"."company_role" = 'member'
    ))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'provisioning' NOT NULL,
	"auth_organization_id" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "companies_status_check" CHECK ("companies"."status" in ('provisioning', 'active', 'setup_failed'))
);
--> statement-breakpoint
CREATE TABLE "company_onboarding_processes" (
	"company_id" varchar(128) PRIMARY KEY NOT NULL,
	"owner_actor_id" varchar(128) NOT NULL,
	"home_actor_id" varchar(128) NOT NULL,
	"home_id" varchar(128) NOT NULL,
	"executor_id" varchar(128) NOT NULL,
	"initial_operation_id" varchar(128) NOT NULL,
	"stage" varchar(32) DEFAULT 'creatingHome' NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"last_error_code" varchar(128),
	"last_error_retryable" boolean,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "company_onboarding_processes_stage_check" CHECK ("company_onboarding_processes"."stage" in ('creatingHome', 'waitingForCodex', 'authorizingCodex', 'initializingHome', 'failed', 'ready')),
	CONSTRAINT "company_onboarding_processes_version_check" CHECK ("company_onboarding_processes"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "company_executors" (
	"executor_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"type" varchar(32) DEFAULT 'codex' NOT NULL,
	"status" varchar(32) DEFAULT 'pending_auth' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"account_id" varchar(255),
	"plan_type" varchar(128),
	"credential_version" bigint DEFAULT 0 NOT NULL,
	"connected_at_ms" bigint,
	"expires_at_ms" bigint,
	"revoked_at_ms" bigint,
	"last_error_code" varchar(128),
	"last_error_retryable" boolean,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "company_executors_type_check" CHECK ("company_executors"."type" = 'codex'),
	CONSTRAINT "company_executors_credential_version_check" CHECK ("company_executors"."credential_version" >= 0),
	CONSTRAINT "company_executors_status_check" CHECK ("company_executors"."status" in ('pending_auth', 'connected', 'expired', 'revoked', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "company_home_instances" (
	"instance_id" varchar(128) PRIMARY KEY NOT NULL,
	"home_id" varchar(128) NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"generation" bigint NOT NULL,
	"source_operation_id" varchar(128) NOT NULL,
	"desired_version" bigint NOT NULL,
	"provider" varchar(32) DEFAULT 'docker' NOT NULL,
	"home_client_url" varchar(2048),
	"container_id" varchar(128),
	"container_name" varchar(255) NOT NULL,
	"volume_name" varchar(255) NOT NULL,
	"image" varchar(512) NOT NULL,
	"template_hash" varchar(128) NOT NULL,
	"observed_state" varchar(32) DEFAULT 'pending' NOT NULL,
	"last_heartbeat_at_ms" bigint,
	"last_error_code" varchar(128),
	"last_error_retryable" boolean,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "company_home_instances_generation_check" CHECK ("company_home_instances"."generation" > 0),
	CONSTRAINT "company_home_instances_desired_version_check" CHECK ("company_home_instances"."desired_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "company_home_leases" (
	"home_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"instance_id" varchar(128) NOT NULL,
	"generation" bigint NOT NULL,
	"callback_token_hash" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'provisioning' NOT NULL,
	"last_heartbeat_at_ms" bigint,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "company_home_leases_status_check" CHECK ("company_home_leases"."status" in ('provisioning', 'awaiting_auth', 'initializing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "company_home_operations" (
	"operation_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"home_id" varchar(128) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"desired_version" bigint NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"attempt" bigint DEFAULT 0 NOT NULL,
	"claimed_by" varchar(128),
	"claim_token" varchar(128),
	"claimed_until_ms" bigint,
	"next_attempt_at_ms" bigint NOT NULL,
	"last_error_code" varchar(128),
	"last_error_retryable" boolean,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "company_home_operations_desired_version_check" CHECK ("company_home_operations"."desired_version" > 0),
	CONSTRAINT "company_home_operations_kind_check" CHECK ("company_home_operations"."kind" in ('provision', 'retry', 'replace', 'initialize')),
	CONSTRAINT "company_home_operations_status_check" CHECK ("company_home_operations"."status" in ('pending', 'claimed', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "company_home_workspaces" (
	"home_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"provider" varchar(32) DEFAULT 'docker-volume' NOT NULL,
	"resource_name" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"last_error_code" varchar(128),
	"last_error_retryable" boolean,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "company_home_workspaces_status_check" CHECK ("company_home_workspaces"."status" in ('pending', 'provisioning', 'awaiting_auth', 'initializing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "executor_auth_attempts" (
	"attempt_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"executor_id" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"last_error_code" varchar(128),
	"last_error_retryable" boolean,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "executor_auth_attempts_status_check" CHECK ("executor_auth_attempts"."status" in ('pending', 'completed', 'cancelled', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "room_actor_bindings" (
	"actor_binding_id" varchar(128) PRIMARY KEY NOT NULL,
	"room_id" varchar(128) NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"sandbox_id" varchar(128) NOT NULL,
	"instance_id" varchar(128) NOT NULL,
	"generation" bigint NOT NULL,
	"lease_id" varchar(128) NOT NULL,
	"actor_id" varchar(128) NOT NULL,
	"actor_type" varchar(32) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"mark" varchar(32) NOT NULL,
	"avatar_resource_id" varchar(128),
	"status" varchar(32) DEFAULT 'initialized' NOT NULL,
	"executor_id" varchar(128),
	"executor_json" jsonb NOT NULL,
	"tool_scope_json" jsonb NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_runtime_presences" (
	"presence_id" varchar(128) PRIMARY KEY NOT NULL,
	"room_id" varchar(128) NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"actor_id" varchar(128) NOT NULL,
	"expires_at_ms" bigint NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_sandbox_instances" (
	"instance_id" varchar(128) PRIMARY KEY NOT NULL,
	"room_id" varchar(128) NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"sandbox_id" varchar(128) NOT NULL,
	"generation" bigint NOT NULL,
	"provider" varchar(32) DEFAULT 'docker' NOT NULL,
	"room_client_url" varchar(2048),
	"container_id" varchar(128),
	"container_name" varchar(255) NOT NULL,
	"volume_name" varchar(255) NOT NULL,
	"image" varchar(512) NOT NULL,
	"template_hash" varchar(128) NOT NULL,
	"observed_state" varchar(32) DEFAULT 'pending' NOT NULL,
	"room_ready" boolean DEFAULT false NOT NULL,
	"agent_ready_count" bigint DEFAULT 0 NOT NULL,
	"agent_total_count" bigint DEFAULT 0 NOT NULL,
	"agent_failed_count" bigint DEFAULT 0 NOT NULL,
	"active_turn_count" bigint DEFAULT 0 NOT NULL,
	"last_heartbeat_at_ms" bigint,
	"last_error" varchar(1024),
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_sandbox_leases" (
	"room_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"sandbox_id" varchar(128) NOT NULL,
	"instance_id" varchar(128) NOT NULL,
	"generation" bigint NOT NULL,
	"lease_id" varchar(128) NOT NULL,
	"callback_token_hash" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'initializing' NOT NULL,
	"runtime_json" jsonb,
	"runtime_ready_at_ms" bigint,
	"last_error" varchar(1024),
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_sandbox_operations" (
	"operation_id" varchar(128) PRIMARY KEY NOT NULL,
	"room_id" varchar(128) NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"sandbox_id" varchar(128) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"desired_version" bigint NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"attempt" bigint DEFAULT 0 NOT NULL,
	"claimed_by" varchar(128),
	"claim_token" varchar(128),
	"claimed_until_ms" bigint,
	"next_attempt_at_ms" bigint NOT NULL,
	"last_error" varchar(1024),
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_sandbox_runtimes" (
	"room_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"sandbox_id" varchar(128) NOT NULL,
	"desired_state" varchar(32) DEFAULT 'parked' NOT NULL,
	"desired_version" bigint DEFAULT 1 NOT NULL,
	"current_instance_id" varchar(128),
	"last_activity_at_ms" bigint NOT NULL,
	"parked_at_ms" bigint,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_sandbox_workspaces" (
	"room_id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"sandbox_id" varchar(128) NOT NULL,
	"provider" varchar(32) DEFAULT 'docker-volume' NOT NULL,
	"resource_name" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'ready' NOT NULL,
	"last_error" varchar(1024),
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_inbox" (
	"event_id" varchar(128) NOT NULL,
	"consumer_name" varchar(128) NOT NULL,
	"processed_at_ms" bigint NOT NULL,
	CONSTRAINT "event_inbox_event_id_consumer_name_pk" PRIMARY KEY("event_id","consumer_name")
);
--> statement-breakpoint
CREATE TABLE "outbox_deliveries" (
	"event_id" varchar(128) NOT NULL,
	"consumer_name" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"attempt" bigint DEFAULT 0 NOT NULL,
	"next_attempt_at_ms" bigint NOT NULL,
	"claimed_by" varchar(128),
	"claim_token" varchar(128),
	"claimed_until_ms" bigint,
	"last_error_code" varchar(128),
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"completed_at_ms" bigint,
	CONSTRAINT "outbox_deliveries_event_id_consumer_name_pk" PRIMARY KEY("event_id","consumer_name"),
	CONSTRAINT "outbox_deliveries_status_check" CHECK ("outbox_deliveries"."status" in ('pending', 'claimed', 'succeeded', 'dead_letter')),
	CONSTRAINT "outbox_deliveries_attempt_check" CHECK ("outbox_deliveries"."attempt" >= 0)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"event_id" varchar(128) PRIMARY KEY NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"schema_version" bigint NOT NULL,
	"aggregate_type" varchar(128) NOT NULL,
	"aggregate_id" varchar(128) NOT NULL,
	"sequence" bigserial NOT NULL,
	"payload_json" jsonb NOT NULL,
	"occurred_at_ms" bigint NOT NULL,
	"dispatched_at_ms" bigint,
	CONSTRAINT "outbox_events_schema_version_check" CHECK ("outbox_events"."schema_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "room_memberships" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"room_id" varchar(128) NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"actor_id" varchar(128) NOT NULL,
	"role" varchar(32) DEFAULT 'member' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"joined_at_ms" bigint NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"company_id" varchar(128) NOT NULL,
	"name" varchar(255) NOT NULL,
	"subtitle" varchar(255),
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_by_actor_id" varchar(128) NOT NULL,
	"membership_version" bigint DEFAULT 1 NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"archived_at_ms" bigint,
	CONSTRAINT "rooms_membership_version_check" CHECK ("rooms"."membership_version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "actors_company_actor_unique" ON "actors" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_executors_company_executor_unique" ON "company_executors" USING btree ("company_id","executor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_instances_identity_unique" ON "company_home_instances" USING btree ("company_id","home_id","instance_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_operations_identity_unique" ON "company_home_operations" USING btree ("company_id","home_id","operation_id","desired_version");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_workspaces_company_home_unique" ON "company_home_workspaces" USING btree ("company_id","home_id");--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_home_human_actor_fk" FOREIGN KEY ("company_id","home_human_actor_id") REFERENCES "public"."actors"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_auth_organization_id_organization_id_fk" FOREIGN KEY ("auth_organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_onboarding_processes" ADD CONSTRAINT "company_onboarding_processes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_executors" ADD CONSTRAINT "company_executors_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_home_instances" ADD CONSTRAINT "company_home_instances_workspace_fk" FOREIGN KEY ("company_id","home_id") REFERENCES "public"."company_home_workspaces"("company_id","home_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_home_instances" ADD CONSTRAINT "company_home_instances_source_operation_fk" FOREIGN KEY ("company_id","home_id","source_operation_id","desired_version") REFERENCES "public"."company_home_operations"("company_id","home_id","operation_id","desired_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_home_leases" ADD CONSTRAINT "company_home_leases_runtime_identity_fk" FOREIGN KEY ("company_id","home_id","instance_id","generation") REFERENCES "public"."company_home_instances"("company_id","home_id","instance_id","generation") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_home_operations" ADD CONSTRAINT "company_home_operations_workspace_fk" FOREIGN KEY ("company_id","home_id") REFERENCES "public"."company_home_workspaces"("company_id","home_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_home_workspaces" ADD CONSTRAINT "company_home_workspaces_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executor_auth_attempts" ADD CONSTRAINT "executor_auth_attempts_company_executor_fk" FOREIGN KEY ("company_id","executor_id") REFERENCES "public"."company_executors"("company_id","executor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_actor_bindings" ADD CONSTRAINT "room_actor_bindings_company_executor_fk" FOREIGN KEY ("company_id","executor_id") REFERENCES "public"."company_executors"("company_id","executor_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_inbox" ADD CONSTRAINT "event_inbox_event_id_outbox_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_deliveries" ADD CONSTRAINT "outbox_deliveries_event_id_outbox_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actors_company_id_idx" ON "actors" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "actors_auth_user_id_unique" ON "actors" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "actors_home_human_actor_id_unique" ON "actors" USING btree ("home_human_actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "actors_company_owner_unique" ON "actors" USING btree ("company_id") WHERE "actors"."company_role" = 'owner';--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_userId_unique" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_auth_organization_id_unique" ON "companies" USING btree ("auth_organization_id");--> statement-breakpoint
CREATE INDEX "company_onboarding_processes_stage_idx" ON "company_onboarding_processes" USING btree ("stage","updated_at_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "company_executors_company_id_unique" ON "company_executors" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_executors_default_unique" ON "company_executors" USING btree ("company_id") WHERE "company_executors"."is_default" = true;--> statement-breakpoint
CREATE INDEX "company_home_instances_company_id_idx" ON "company_home_instances" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_home_instances_home_id_idx" ON "company_home_instances" USING btree ("home_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_instances_generation_unique" ON "company_home_instances" USING btree ("home_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_instances_desired_version_unique" ON "company_home_instances" USING btree ("home_id","desired_version");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_instances_container_name_unique" ON "company_home_instances" USING btree ("container_name");--> statement-breakpoint
CREATE INDEX "company_home_leases_company_id_idx" ON "company_home_leases" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_leases_instance_id_unique" ON "company_home_leases" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_leases_callback_hash_unique" ON "company_home_leases" USING btree ("callback_token_hash");--> statement-breakpoint
CREATE INDEX "company_home_operations_claim_idx" ON "company_home_operations" USING btree ("status","next_attempt_at_ms","claimed_until_ms");--> statement-breakpoint
CREATE INDEX "company_home_operations_company_id_idx" ON "company_home_operations" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_operations_desired_version_unique" ON "company_home_operations" USING btree ("home_id","desired_version");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_workspaces_company_id_unique" ON "company_home_workspaces" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_home_workspaces_resource_name_unique" ON "company_home_workspaces" USING btree ("resource_name");--> statement-breakpoint
CREATE INDEX "executor_auth_attempts_company_id_idx" ON "executor_auth_attempts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "executor_auth_attempts_executor_id_idx" ON "executor_auth_attempts" USING btree ("executor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "executor_auth_attempts_pending_unique" ON "executor_auth_attempts" USING btree ("executor_id") WHERE "executor_auth_attempts"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "room_actor_bindings_actor_id_idx" ON "room_actor_bindings" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "room_actor_bindings_company_id_idx" ON "room_actor_bindings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "room_actor_bindings_room_id_idx" ON "room_actor_bindings" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_actor_bindings_sandbox_id_idx" ON "room_actor_bindings" USING btree ("sandbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_actor_bindings_room_actor_unique" ON "room_actor_bindings" USING btree ("room_id","actor_id");--> statement-breakpoint
CREATE INDEX "room_runtime_presences_room_expiry_idx" ON "room_runtime_presences" USING btree ("room_id","expires_at_ms");--> statement-breakpoint
CREATE INDEX "room_runtime_presences_actor_id_idx" ON "room_runtime_presences" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "room_sandbox_instances_room_id_idx" ON "room_sandbox_instances" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_sandbox_instances_company_id_idx" ON "room_sandbox_instances" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "room_sandbox_instances_sandbox_id_idx" ON "room_sandbox_instances" USING btree ("sandbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_sandbox_instances_generation_unique" ON "room_sandbox_instances" USING btree ("sandbox_id","generation");--> statement-breakpoint
CREATE INDEX "room_sandbox_leases_company_id_idx" ON "room_sandbox_leases" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "room_sandbox_leases_sandbox_id_idx" ON "room_sandbox_leases" USING btree ("sandbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_sandbox_leases_lease_id_unique" ON "room_sandbox_leases" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "room_sandbox_operations_claim_idx" ON "room_sandbox_operations" USING btree ("status","next_attempt_at_ms","claimed_until_ms");--> statement-breakpoint
CREATE INDEX "room_sandbox_operations_room_id_idx" ON "room_sandbox_operations" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_sandbox_operations_idempotency_unique" ON "room_sandbox_operations" USING btree ("sandbox_id","kind","desired_version");--> statement-breakpoint
CREATE INDEX "room_sandbox_runtimes_company_id_idx" ON "room_sandbox_runtimes" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_sandbox_runtimes_sandbox_id_unique" ON "room_sandbox_runtimes" USING btree ("sandbox_id");--> statement-breakpoint
CREATE INDEX "room_sandbox_workspaces_company_id_idx" ON "room_sandbox_workspaces" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_sandbox_workspaces_sandbox_id_unique" ON "room_sandbox_workspaces" USING btree ("sandbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_sandbox_workspaces_resource_name_unique" ON "room_sandbox_workspaces" USING btree ("resource_name");--> statement-breakpoint
CREATE INDEX "event_inbox_consumer_processed_idx" ON "event_inbox" USING btree ("consumer_name","processed_at_ms");--> statement-breakpoint
CREATE INDEX "outbox_deliveries_consumer_claim_idx" ON "outbox_deliveries" USING btree ("consumer_name","status","next_attempt_at_ms","claimed_until_ms");--> statement-breakpoint
CREATE INDEX "outbox_deliveries_status_updated_idx" ON "outbox_deliveries" USING btree ("status","updated_at_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_sequence_unique" ON "outbox_events" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "outbox_events_dispatch_sequence_idx" ON "outbox_events" USING btree ("dispatched_at_ms","sequence");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_sequence_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id","sequence");--> statement-breakpoint
CREATE INDEX "room_memberships_actor_id_idx" ON "room_memberships" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "room_memberships_company_id_idx" ON "room_memberships" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "room_memberships_room_id_idx" ON "room_memberships" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_memberships_room_actor_unique" ON "room_memberships" USING btree ("room_id","actor_id");--> statement-breakpoint
CREATE INDEX "rooms_company_id_idx" ON "rooms" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "rooms_created_by_actor_id_idx" ON "rooms" USING btree ("created_by_actor_id");
