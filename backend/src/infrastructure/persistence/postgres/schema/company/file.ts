import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { companies } from "../company.js";

export const companyFileFolders = pgTable("company_file_folders", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  parentFolderId: varchar("parent_folder_id", { length: 128 }),
  name: varchar("name", { length: 255 }).notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  createdByActorId: varchar("created_by_actor_id", { length: 128 }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("company_file_folders_company_id_unique").on(table.companyId, table.id),
  uniqueIndex("company_file_folders_sibling_name_unique").on(
    table.companyId,
    sql`coalesce(${table.parentFolderId}, '')`,
    table.name,
  ),
  index("company_file_folders_parent_idx").on(table.companyId, table.parentFolderId),
  check("company_file_folders_revision_check", sql`${table.revision} > 0`),
  check("company_file_folders_parent_self_check", sql`${table.parentFolderId} is null or ${table.parentFolderId} <> ${table.id}`),
]);

export const companyFileBlobs = pgTable("company_file_blobs", {
  companyId: varchar("company_id", { length: 128 }).notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  objectKey: varchar("object_key", { length: 1024 }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.companyId, table.sha256] }),
  uniqueIndex("company_file_blobs_object_key_unique").on(table.objectKey),
  check("company_file_blobs_sha_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  check("company_file_blobs_size_check", sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 26214400`),
]);

export const companyFiles = pgTable("company_files", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  folderId: varchar("folder_id", { length: 128 }),
  name: varchar("name", { length: 255 }).notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  currentVersionId: varchar("current_version_id", { length: 128 }).notNull(),
  createdByActorId: varchar("created_by_actor_id", { length: 128 }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("company_files_company_id_unique").on(table.companyId, table.id),
  uniqueIndex("company_files_sibling_name_unique").on(
    table.companyId,
    sql`coalesce(${table.folderId}, '')`,
    table.name,
  ),
  index("company_files_folder_idx").on(table.companyId, table.folderId, table.updatedAtMs),
  check("company_files_revision_check", sql`${table.revision} > 0`),
]);

export const companyFileVersions = pgTable("company_file_versions", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  fileId: varchar("file_id", { length: 128 }).notNull(),
  versionNumber: bigint("version_number", { mode: "number" }).notNull(),
  blobSha256: varchar("blob_sha256", { length: 64 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  mimeType: varchar("mime_type", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  createdByActorId: varchar("created_by_actor_id", { length: 128 }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("company_file_versions_company_id_unique").on(table.companyId, table.id),
  uniqueIndex("company_file_versions_number_unique").on(table.fileId, table.versionNumber),
  index("company_file_versions_blob_idx").on(table.companyId, table.blobSha256),
  check("company_file_versions_number_check", sql`${table.versionNumber} > 0`),
  check("company_file_versions_size_check", sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 26214400`),
]);

export const companyFileUploads = pgTable("company_file_uploads", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  requestedByActorId: varchar("requested_by_actor_id", { length: 128 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
  fileId: varchar("file_id", { length: 128 }),
  expectedRevision: bigint("expected_revision", { mode: "number" }),
  folderId: varchar("folder_id", { length: 128 }),
  name: varchar("name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 255 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  objectKey: varchar("object_key", { length: 1024 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  resultFileId: varchar("result_file_id", { length: 128 }),
  expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  completedAtMs: bigint("completed_at_ms", { mode: "number" }),
}, (table) => [
  uniqueIndex("company_file_uploads_actor_key_unique").on(
    table.companyId,
    table.requestedByActorId,
    table.idempotencyKey,
  ),
  index("company_file_uploads_expiry_idx").on(table.status, table.expiresAtMs),
  check("company_file_uploads_status_check", sql`${table.status} in ('pending', 'completed')`),
  check("company_file_uploads_size_check", sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 26214400`),
]);

export const companyFileShares = pgTable("company_file_shares", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  fileId: varchar("file_id", { length: 128 }).notNull()
    .references(() => companyFiles.id, { onDelete: "cascade" }),
  createdByActorId: varchar("created_by_actor_id", { length: 128 }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  expiresAtMs: bigint("expires_at_ms", { mode: "number" }),
  revokedAtMs: bigint("revoked_at_ms", { mode: "number" }),
}, (table) => [
  uniqueIndex("company_file_shares_company_id_unique").on(table.companyId, table.id),
  index("company_file_shares_owner_file_idx").on(
    table.companyId,
    table.createdByActorId,
    table.fileId,
    table.createdAtMs,
  ),
  index("company_file_shares_expiry_idx").on(table.expiresAtMs),
  check(
    "company_file_shares_expiry_check",
    sql`${table.expiresAtMs} is null or ${table.expiresAtMs} > ${table.createdAtMs}`,
  ),
]);

export const companyFileMutationReceipts = pgTable("company_file_mutation_receipts", {
  companyId: varchar("company_id", { length: 128 }).notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  actorId: varchar("actor_id", { length: 128 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
  operation: varchar("operation", { length: 64 }).notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  result: jsonb("result").notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.companyId, table.actorId, table.idempotencyKey] }),
]);
