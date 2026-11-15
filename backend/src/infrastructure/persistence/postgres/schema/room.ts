import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const rooms = pgTable("rooms", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  subtitle: varchar("subtitle", { length: 255 }),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  createdByActorId: varchar("created_by_actor_id", { length: 128 }).notNull(),
  membershipVersion: bigint("membership_version", { mode: "number" }).notNull().default(1),
  nextMessageSequence: bigint("next_message_sequence", { mode: "number" }).notNull().default(1),
  nextMessageEventSequence: bigint("next_message_event_sequence", { mode: "number" }).notNull().default(1),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  archivedAtMs: bigint("archived_at_ms", { mode: "number" }),
}, (table) => [
  index("rooms_company_id_idx").on(table.companyId),
  index("rooms_created_by_actor_id_idx").on(table.createdByActorId),
  uniqueIndex("rooms_room_company_unique").on(table.id, table.companyId),
  check("rooms_membership_version_check", sql`${table.membershipVersion} >= 0`),
  check("rooms_next_message_sequence_check", sql`${table.nextMessageSequence} > 0`),
  check("rooms_next_message_event_sequence_check", sql`${table.nextMessageEventSequence} > 0`),
]);

export const roomMemberships = pgTable("room_memberships", {
  id: varchar("id", { length: 128 }).primaryKey(),
  roomId: varchar("room_id", { length: 128 }).notNull(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  actorId: varchar("actor_id", { length: 128 }).notNull(),
  role: varchar("role", { length: 32 }).notNull().default("member"),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  joinedAtMs: bigint("joined_at_ms", { mode: "number" }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("room_memberships_actor_id_idx").on(table.actorId),
  index("room_memberships_company_id_idx").on(table.companyId),
  index("room_memberships_room_id_idx").on(table.roomId),
  uniqueIndex("room_memberships_room_actor_unique").on(table.roomId, table.actorId),
]);
