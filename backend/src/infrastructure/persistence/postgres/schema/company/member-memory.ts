import { sql } from "drizzle-orm";
import { bigint, boolean, check, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const memberMemoryProfiles = pgTable("member_memory_profiles", {
  companyId: varchar("company_id", { length: 128 }).notNull(),
  memberId: varchar("member_id", { length: 128 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  appliedEnabled: boolean("applied_enabled").notNull().default(true),
  status: varchar("status", { length: 32 }).notNull().default("ready"),
  errorCode: varchar("error_code", { length: 128 }),
  operationId: varchar("operation_id", { length: 128 }),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("member_memory_profiles_company_member_unique")
    .on(table.companyId, table.memberId),
  check("member_memory_profiles_status_check", sql`${table.status} in ('ready', 'applying', 'failed')`),
]);
