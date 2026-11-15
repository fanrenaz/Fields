import { bigint, pgTable, primaryKey, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const roomSideChats = pgTable("room_side_chats", {
  companyId: varchar("company_id", { length: 128 }).notNull(),
  humanMemberId: varchar("human_member_id", { length: 128 }).notNull(),
  roomId: varchar("room_id", { length: 128 }).notNull(),
  threadId: varchar("thread_id", { length: 255 }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({
    columns: [table.companyId, table.humanMemberId, table.roomId],
    name: "room_side_chats_pk",
  }),
  uniqueIndex("room_side_chats_operator_thread_unique")
    .on(table.companyId, table.humanMemberId, table.threadId),
]);
