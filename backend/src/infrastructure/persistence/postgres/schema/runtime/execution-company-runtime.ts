import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  jsonb,
  pgTable,
  varchar,
} from "drizzle-orm/pg-core";

import { companies } from "../company.js";

/** Latest operational projection reported by the fixed Company Runtime. */
export const companyRuntimeStatuses = pgTable("company_runtime_status", {
  companyId: varchar("company_id", { length: 128 })
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  state: varchar("state", { length: 32 }).notNull().default("starting"),
  activeMemberServerCount: bigint("active_member_server_count", { mode: "number" })
    .notNull()
    .default(0),
  activeExecutionCount: bigint("active_execution_count", { mode: "number" })
    .notNull()
    .default(0),
  statusJson: jsonb("status_json").notNull().default(sql`'{}'::jsonb`),
  lastErrorCode: varchar("last_error_code", { length: 128 }),
  lastErrorRetryable: boolean("last_error_retryable"),
  observedAtMs: bigint("observed_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  check(
    "company_runtime_status_state_check",
    sql`${table.state} in ('starting', 'ready', 'degraded', 'stopping', 'failed')`,
  ),
  check(
    "company_runtime_status_counts_check",
    sql`${table.activeMemberServerCount} >= 0 and ${table.activeExecutionCount} >= 0`,
  ),
]);
