import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { organization } from "./better-auth.js";

export const companies = pgTable("companies", {
  id: varchar("id", { length: 128 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("provisioning"),
  authOrganizationId: text("auth_organization_id")
    .references(() => organization.id),
  desktopBrowserEnabled: boolean("desktop_browser_enabled").notNull().default(true),
  desktopBrowserUpdatedAtMs: bigint("desktop_browser_updated_at_ms", { mode: "number" }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("companies_auth_organization_id_unique").on(table.authOrganizationId),
  check(
    "companies_status_check",
    sql`${table.status} in ('provisioning', 'active', 'setup_failed')`,
  ),
]);

/**
 * Company-owned progress projection and correlation state for the onboarding
 * application process. It deliberately does not own Actor or Execution facts.
 */
export const companyOnboardingProcesses = pgTable("company_onboarding_processes", {
  companyId: varchar("company_id", { length: 128 })
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  ownerActorId: varchar("owner_actor_id", { length: 128 }).notNull(),
  runtimeId: varchar("runtime_id", { length: 128 }).notNull(),
  executorId: varchar("executor_id", { length: 128 }),
  initialOperationId: varchar("initial_operation_id", { length: 128 }).notNull(),
  stage: varchar("stage", { length: 32 }).notNull().default("creatingRuntime"),
  version: bigint("version", { mode: "number" }).notNull().default(0),
  lastErrorCode: varchar("last_error_code", { length: 128 }),
  lastErrorRetryable: boolean("last_error_retryable"),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("company_onboarding_processes_stage_idx").on(table.stage, table.updatedAtMs),
  check(
    "company_onboarding_processes_stage_check",
    sql`${table.stage} in ('creatingRuntime', 'initializingRuntime', 'failed', 'ready')`,
  ),
  check(
    "company_onboarding_processes_version_check",
    sql`${table.version} >= 0`,
  ),
]);

/** Backend-owned Company Device control-plane record. Raw tokens never persist. */
export const companyDevices = pgTable("company_devices", {
  deviceId: varchar("device_id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull().references(() => companies.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  currentTokenHash: varchar("current_token_hash", { length: 128 }).notNull(),
  currentTokenVersion: bigint("current_token_version", { mode: "number" }).notNull().default(1),
  pendingTokenHash: varchar("pending_token_hash", { length: 128 }),
  pendingTokenVersion: bigint("pending_token_version", { mode: "number" }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  pairedAtMs: bigint("paired_at_ms", { mode: "number" }).notNull(),
  revokedAtMs: bigint("revoked_at_ms", { mode: "number" }),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("company_devices_company_id_idx").on(table.companyId),
  index("company_devices_active_company_idx").on(table.companyId, table.status),
  check("company_devices_status_check", sql`${table.status} in ('active', 'revoked')`),
  check("company_devices_current_token_version_check", sql`${table.currentTokenVersion} > 0`),
  check("company_devices_pending_token_shape_check", sql`(
    (${table.pendingTokenHash} is null and ${table.pendingTokenVersion} is null)
    or (${table.pendingTokenHash} is not null and ${table.pendingTokenVersion} is not null and ${table.pendingTokenVersion} > ${table.currentTokenVersion})
  )`),
]);
