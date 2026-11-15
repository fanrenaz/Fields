import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { actors } from "../actor.js";
import { companies } from "../company.js";

/**
 * Company-scoped credential identity. The credential bytes remain exclusively
 * in Company Runtime; Backend persists only safe account and lifecycle facts.
 */
export const companyExecutors = pgTable("company_executors", {
  executorId: varchar("executor_id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  ownerMemberId: varchar("owner_member_id", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  executorType: varchar("executor_type", { length: 32 }).notNull().default("codex"),
  authorizationMethod: varchar("authorization_method", { length: 32 }).notNull().default("chatgpt"),
  configurationStatus: varchar("configuration_status", { length: 32 }).notNull().default("pending"),
  configurationRevision: bigint("configuration_revision", { mode: "number" }).notNull().default(0),
  allowedModelsJson: jsonb("allowed_models_json").notNull().default([]),
  allowedReasoningEffortsJson: jsonb("allowed_reasoning_efforts_json").notNull().default([]),
  defaultModel: varchar("default_model", { length: 512 }),
  defaultReasoningEffort: varchar("default_reasoning_effort", { length: 64 }),
  catalogCheckedAtMs: bigint("catalog_checked_at_ms", { mode: "number" }),
  configurationUpdatedAtMs: bigint("configuration_updated_at_ms", { mode: "number" }),
  sharingState: varchar("sharing_state", { length: 32 }).notNull().default("private"),
  status: varchar("status", { length: 32 }).notNull().default("pending_auth"),
  accountId: varchar("account_id", { length: 255 }),
  planType: varchar("plan_type", { length: 128 }),
  endpointHost: varchar("endpoint_host", { length: 512 }),
  credentialVersion: bigint("credential_version", { mode: "number" }).notNull().default(0),
  connectedAtMs: bigint("connected_at_ms", { mode: "number" }),
  expiresAtMs: bigint("expires_at_ms", { mode: "number" }),
  revokedAtMs: bigint("revoked_at_ms", { mode: "number" }),
  lastErrorCode: varchar("last_error_code", { length: 128 }),
  lastErrorRetryable: boolean("last_error_retryable"),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("company_executors_company_executor_unique").on(table.companyId, table.executorId),
  uniqueIndex("company_executors_owner_name_unique").on(
    table.companyId,
    table.ownerMemberId,
    table.name,
  ),
  uniqueIndex("company_executors_company_account_unique")
    .on(table.companyId, table.accountId)
    .where(sql`${table.accountId} is not null`),
  foreignKey({
    columns: [table.companyId],
    foreignColumns: [companies.id],
    name: "company_executors_company_id_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.companyId, table.ownerMemberId],
    foreignColumns: [actors.companyId, actors.id],
    name: "company_executors_owner_member_fk",
  }).onDelete("restrict"),
  check(
    "company_executors_sharing_state_check",
    sql`${table.sharingState} in ('private', 'company_shared', 'admin_blocked')`,
  ),
  check("company_executors_credential_version_check", sql`${table.credentialVersion} >= 0`),
  check("company_executors_type_check", sql`${table.executorType} = 'codex'`),
  check(
    "company_executors_configuration_status_check",
    sql`${table.configurationStatus} in ('pending', 'validating', 'ready', 'invalid')`,
  ),
  check("company_executors_configuration_revision_check", sql`${table.configurationRevision} >= 0`),
  check(
    "company_executors_authorization_method_check",
    sql`${table.authorizationMethod} in ('chatgpt', 'custom_api_key')`,
  ),
  check(
    "company_executors_authorization_projection_check",
    sql`(
      (${table.authorizationMethod} = 'chatgpt' and ${table.endpointHost} is null)
      or
      (${table.authorizationMethod} = 'custom_api_key'
        and ${table.accountId} is null
        and ${table.planType} is null)
    )`,
  ),
  check(
    "company_executors_status_check",
    sql`${table.status} in ('pending_auth', 'connected', 'expired', 'revoked', 'failed')`,
  ),
]);

/**
 * The single canonical Executor binding for any Company Member, Human or
 * Agent. A pending switch is explicit and never overwrites the committed
 * binding until Company Runtime reports a successful drain/restart/resume.
 */
export const memberExecutorAssignments = pgTable("member_executor_assignments", {
  memberId: varchar("member_id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  executorId: varchar("executor_id", { length: 128 }).notNull(),
  pendingExecutorId: varchar("pending_executor_id", { length: 128 }),
  previousExecutorId: varchar("previous_executor_id", { length: 128 }),
  assignmentVersion: bigint("assignment_version", { mode: "number" }).notNull().default(1),
  state: varchar("state", { length: 32 }).notNull().default("ready"),
  switchOperationId: varchar("switch_operation_id", { length: 128 }),
  lastErrorCode: varchar("last_error_code", { length: 128 }),
  lastErrorRetryable: boolean("last_error_retryable"),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("member_executor_assignments_company_id_idx").on(table.companyId),
  uniqueIndex("member_executor_assignments_switch_operation_unique")
    .on(table.switchOperationId)
    .where(sql`${table.switchOperationId} is not null`),
  foreignKey({
    columns: [table.companyId, table.memberId],
    foreignColumns: [actors.companyId, actors.id],
    name: "member_executor_assignments_member_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.companyId, table.executorId],
    foreignColumns: [companyExecutors.companyId, companyExecutors.executorId],
    name: "member_executor_assignments_executor_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.companyId, table.pendingExecutorId],
    foreignColumns: [companyExecutors.companyId, companyExecutors.executorId],
    name: "member_executor_assignments_pending_executor_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.companyId, table.previousExecutorId],
    foreignColumns: [companyExecutors.companyId, companyExecutors.executorId],
    name: "member_executor_assignments_previous_executor_fk",
  }).onDelete("restrict"),
  check("member_executor_assignments_version_check", sql`${table.assignmentVersion} > 0`),
  check(
    "member_executor_assignments_state_check",
    sql`${table.state} in ('ready', 'switching', 'configuration_required', 'auth_required', 'failed')`,
  ),
  check(
    "member_executor_assignments_switch_shape_check",
    sql`(
      (${table.state} = 'switching'
        and ${table.pendingExecutorId} is not null
        and ${table.previousExecutorId} is not null
        and ${table.switchOperationId} is not null)
      or
      (${table.state} <> 'switching'
        and ${table.pendingExecutorId} is null
        and ${table.previousExecutorId} is null
        and ${table.switchOperationId} is null)
    )`,
  ),
]);

export const executorAuthAttempts = pgTable("executor_auth_attempts", {
  attemptId: varchar("attempt_id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  executorId: varchar("executor_id", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  lastErrorCode: varchar("last_error_code", { length: 128 }),
  lastErrorRetryable: boolean("last_error_retryable"),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("executor_auth_attempts_company_id_idx").on(table.companyId),
  index("executor_auth_attempts_executor_id_idx").on(table.executorId),
  uniqueIndex("executor_auth_attempts_pending_unique")
    .on(table.executorId)
    .where(sql`${table.status} = 'pending'`),
  foreignKey({
    columns: [table.companyId, table.executorId],
    foreignColumns: [companyExecutors.companyId, companyExecutors.executorId],
    name: "executor_auth_attempts_company_executor_fk",
  }).onDelete("cascade"),
  check(
    "executor_auth_attempts_status_check",
    sql`${table.status} in ('pending', 'completed', 'cancelled', 'failed')`,
  ),
]);
