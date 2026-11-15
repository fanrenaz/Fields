import { bigint, index, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const agentBuilderProfiles = pgTable("agent_builder_profiles", {
  companyId: varchar("company_id", { length: 128 }).notNull(),
  agentMemberId: varchar("agent_member_id", { length: 128 }).notNull(),
  description: text("description").notNull().default(""),
  avatar: varchar("avatar", { length: 32 }).notNull().default("🤖"),
  instructions: text("instructions").notNull().default(""),
  readiness: varchar("readiness", { length: 32 }).notNull().default("draft"),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("agent_builder_profiles_company_agent_unique")
    .on(table.companyId, table.agentMemberId),
]);

export const agentBuilderTopics = pgTable("agent_builder_topics", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  humanMemberId: varchar("human_member_id", { length: 128 }).notNull(),
  agentMemberId: varchar("agent_member_id", { length: 128 }).notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  threadId: varchar("thread_id", { length: 255 }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("agent_builder_topics_operator_agent_idx")
    .on(table.companyId, table.humanMemberId, table.agentMemberId, table.updatedAtMs),
  uniqueIndex("agent_builder_topics_operator_thread_unique")
    .on(table.companyId, table.humanMemberId, table.threadId),
]);
