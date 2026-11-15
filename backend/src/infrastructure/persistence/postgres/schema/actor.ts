import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { user } from "./better-auth.js";

export const actors = pgTable("actors", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  type: varchar("type", { length: 32 }).notNull().default("human"),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  mark: varchar("mark", { length: 32 }).notNull(),
  companyRole: varchar("company_role", { length: 32 }).notNull().default("member"),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  authUserId: text("auth_user_id")
    .references(() => user.id),
  systemRole: varchar("system_role", { length: 32 }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("actors_company_id_idx").on(table.companyId),
  uniqueIndex("actors_auth_user_id_unique").on(table.authUserId),
  uniqueIndex("actors_company_actor_unique").on(table.companyId, table.id),
  uniqueIndex("actors_company_owner_unique")
    .on(table.companyId)
    .where(sql`${table.companyRole} = 'owner'`),
  uniqueIndex("actors_company_scheduler_unique")
    .on(table.companyId)
    .where(sql`${table.systemRole} = 'scheduler'`),
  check("actors_system_role_check", sql`${table.systemRole} is null or ${table.systemRole} = 'scheduler'`),
  check("actors_scheduler_shape_check", sql`${table.systemRole} is null or (
    ${table.type} = 'human' and ${table.companyRole} = 'member'
    and ${table.status} = 'active' and ${table.authUserId} is null
  )`),
]);

export const agentMemberCleanupOperations = pgTable("agent_member_cleanup_operations", {
  operationId: varchar("operation_id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  memberId: varchar("member_id", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  attempt: bigint("attempt", { mode: "number" }).notNull().default(0),
  lastErrorCode: varchar("last_error_code", { length: 128 }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  completedAtMs: bigint("completed_at_ms", { mode: "number" }),
}, (table) => [
  uniqueIndex("agent_member_cleanup_operations_pending_member_unique")
    .on(table.companyId, table.memberId)
    .where(sql`${table.status} = 'pending'`),
  foreignKey({
    name: "agent_member_cleanup_operations_actor_fk",
    columns: [table.companyId, table.memberId],
    foreignColumns: [actors.companyId, actors.id],
  }).onDelete("restrict"),
  check(
    "agent_member_cleanup_operations_status_check",
    sql`${table.status} in ('pending', 'succeeded', 'failed')`,
  ),
]);
