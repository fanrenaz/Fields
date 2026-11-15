import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { companies } from "../company.js";

export const companyRegistrationSettings = pgTable("company_registration_settings", {
  companyId: varchar("company_id", { length: 128 })
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 128 }).notNull(),
  codeVersion: bigint("code_version", { mode: "number" }).notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  updatedByActorId: varchar("updated_by_actor_id", { length: 128 }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  check("company_registration_settings_code_version_check", sql`${table.codeVersion} > 0`),
]);

export const registrationSignupGrants = pgTable("registration_signup_grants", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 })
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  credentialHash: varchar("credential_hash", { length: 128 }).notNull(),
  normalizedEmail: text("normalized_email").notNull(),
  codeVersion: bigint("code_version", { mode: "number" }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("prepared"),
  expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
  claimedAtMs: bigint("claimed_at_ms", { mode: "number" }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("registration_signup_grants_credential_hash_unique").on(table.credentialHash),
  index("registration_signup_grants_company_status_idx").on(table.companyId, table.status),
  index("registration_signup_grants_expiry_idx").on(table.expiresAtMs),
  check("registration_signup_grants_code_version_check", sql`${table.codeVersion} > 0`),
  check("registration_signup_grants_status_check", sql`${table.status} in ('prepared', 'claimed')`),
]);
