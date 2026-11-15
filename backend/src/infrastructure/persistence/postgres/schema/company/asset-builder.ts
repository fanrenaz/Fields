import { bigint, index, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const assetBuilderTopics = pgTable("asset_builder_topics", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  humanMemberId: varchar("human_member_id", { length: 128 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  assetId: varchar("asset_id", { length: 128 }),
  draftId: varchar("draft_id", { length: 128 }),
  title: varchar("title", { length: 120 }).notNull(),
  threadId: varchar("thread_id", { length: 255 }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("asset_builder_topics_operator_target_idx")
    .on(
      table.companyId,
      table.humanMemberId,
      table.kind,
      table.assetId,
      table.updatedAtMs,
    ),
  uniqueIndex("asset_builder_topics_operator_thread_unique")
    .on(table.companyId, table.humanMemberId, table.threadId),
]);
