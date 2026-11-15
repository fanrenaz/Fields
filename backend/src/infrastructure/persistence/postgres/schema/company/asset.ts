import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  AssetFileEntry,
  AssetSource,
  AssetValidationSnapshot,
  MemberAssetTarget,
} from "@fields/contracts/public/asset";

import { companies } from "../company.js";

export const companyAssets = pgTable("company_assets", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 })
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").notNull().default(""),
  lifecycle: varchar("lifecycle", { length: 32 }).notNull().default("draft"),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  currentVersionId: varchar("current_version_id", { length: 128 }),
  createdByActorId: varchar("created_by_actor_id", { length: 128 }).notNull(),
  updatedByActorId: varchar("updated_by_actor_id", { length: 128 }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  archivedAtMs: bigint("archived_at_ms", { mode: "number" }),
}, (table) => [
  uniqueIndex("company_assets_company_kind_slug_unique").on(
    table.companyId,
    table.kind,
    table.slug,
  ),
  uniqueIndex("company_assets_company_id_unique").on(table.companyId, table.id),
  index("company_assets_company_lifecycle_idx").on(
    table.companyId,
    table.lifecycle,
    table.updatedAtMs,
  ),
  check("company_assets_kind_check", sql`${table.kind} in ('plugin', 'skill', 'mcp')`),
  check(
    "company_assets_lifecycle_check",
    sql`${table.lifecycle} in ('draft', 'published', 'archived')`,
  ),
  check("company_assets_revision_check", sql`${table.revision} > 0`),
  check(
    "company_assets_reserved_identity_check",
    sql`${table.slug} <> 'fields-core' and lower(${table.name}) <> 'fields-core'`,
  ),
]);

export const companyAssetDrafts = pgTable("company_asset_drafts", {
  id: varchar("id", { length: 128 }).primaryKey(),
  assetId: varchar("asset_id", { length: 128 }).notNull(),
  companyId: varchar("company_id", { length: 128 })
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").notNull().default(""),
  version: varchar("version", { length: 128 }),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  source: jsonb("source").$type<AssetSource>(),
  credentialOperationId: varchar("credential_operation_id", { length: 128 }),
  contentSha256: varchar("content_sha256", { length: 64 }),
  files: jsonb("files").$type<AssetFileEntry[]>().notNull().default([]),
  validation: jsonb("validation").$type<AssetValidationSnapshot>().notNull(),
  createdByActorId: varchar("created_by_actor_id", { length: 128 }).notNull(),
  updatedByActorId: varchar("updated_by_actor_id", { length: 128 }).notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("company_asset_drafts_company_idx").on(table.companyId, table.updatedAtMs),
  index("company_asset_drafts_asset_idx").on(table.assetId, table.updatedAtMs),
  foreignKey({
    columns: [table.companyId, table.assetId],
    foreignColumns: [companyAssets.companyId, companyAssets.id],
    name: "company_asset_drafts_company_asset_fk",
  }).onDelete("cascade"),
  check("company_asset_drafts_kind_check", sql`${table.kind} in ('plugin', 'skill', 'mcp')`),
  check("company_asset_drafts_revision_check", sql`${table.revision} > 0`),
  check(
    "company_asset_drafts_reserved_identity_check",
    sql`${table.slug} <> 'fields-core' and lower(${table.name}) <> 'fields-core'`,
  ),
]);

export const companyAssetVersions = pgTable("company_asset_versions", {
  id: varchar("id", { length: 128 }).primaryKey(),
  sourceDraftId: varchar("source_draft_id", { length: 128 }).notNull(),
  assetId: varchar("asset_id", { length: 128 }).notNull(),
  companyId: varchar("company_id", { length: 128 })
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  version: varchar("version", { length: 128 }).notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  source: jsonb("source").$type<AssetSource>().notNull(),
  contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
  files: jsonb("files").$type<AssetFileEntry[]>().notNull().default([]),
  validation: jsonb("validation").$type<AssetValidationSnapshot>().notNull(),
  publishedByActorId: varchar("published_by_actor_id", { length: 128 }).notNull(),
  publishedAtMs: bigint("published_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("company_asset_versions_asset_version_unique").on(
    table.assetId,
    table.version,
  ),
  uniqueIndex("company_asset_versions_source_draft_unique").on(
    table.companyId,
    table.sourceDraftId,
  ),
  uniqueIndex("company_asset_versions_company_kind_slug_version_unique").on(
    table.companyId,
    table.kind,
    table.slug,
    table.version,
  ),
  uniqueIndex("company_asset_versions_company_asset_id_unique").on(
    table.companyId,
    table.assetId,
    table.id,
  ),
  index("company_asset_versions_asset_published_idx").on(
    table.assetId,
    table.publishedAtMs,
  ),
  foreignKey({
    columns: [table.companyId, table.assetId],
    foreignColumns: [companyAssets.companyId, companyAssets.id],
    name: "company_asset_versions_company_asset_fk",
  }).onDelete("restrict"),
  check("company_asset_versions_kind_check", sql`${table.kind} in ('plugin', 'skill', 'mcp')`),
  check("company_asset_versions_revision_check", sql`${table.revision} > 0`),
  check("company_asset_versions_reserved_identity_check", sql`${table.slug} <> 'fields-core'`),
]);

/**
 * Mutable, credential-safe control state for an immutable published MCP
 * version. Bearer values remain Runtime-owned; Backend stores only fencing and
 * the public configured/not-configured projection.
 */
export const companyAssetVersionCredentials = pgTable("company_asset_version_credentials", {
  versionId: varchar("version_id", { length: 128 }).primaryKey(),
  assetId: varchar("asset_id", { length: 128 }).notNull(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  credentialOperationId: varchar("credential_operation_id", { length: 128 }),
  credentialConfigured: boolean("credential_configured").notNull().default(false),
  updatedByActorId: varchar("updated_by_actor_id", { length: 128 }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  index("company_asset_version_credentials_asset_idx").on(
    table.companyId,
    table.assetId,
  ),
  foreignKey({
    columns: [table.companyId, table.assetId, table.versionId],
    foreignColumns: [
      companyAssetVersions.companyId,
      companyAssetVersions.assetId,
      companyAssetVersions.id,
    ],
    name: "company_asset_version_credentials_version_fk",
  }).onDelete("cascade"),
  check(
    "company_asset_version_credentials_revision_check",
    sql`${table.revision} > 0`,
  ),
]);

export const companyAssetMutationReceipts = pgTable("company_asset_mutation_receipts", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 })
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  actorId: varchar("actor_id", { length: 128 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
  operation: varchar("operation", { length: 64 }).notNull(),
  requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  phase: varchar("phase", { length: 64 }).notNull().default("claimed"),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>(),
  errorCode: varchar("error_code", { length: 128 }),
  errorRetryable: boolean("error_retryable"),
  leaseOwner: varchar("lease_owner", { length: 128 }),
  leaseExpiresAtMs: bigint("lease_expires_at_ms", { mode: "number" }),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  completedAtMs: bigint("completed_at_ms", { mode: "number" }),
}, (table) => [
  uniqueIndex("company_asset_receipts_actor_key_unique").on(
    table.companyId,
    table.actorId,
    table.idempotencyKey,
  ),
  check(
    "company_asset_receipts_status_check",
    sql`${table.status} in ('pending', 'completed', 'failed')`,
  ),
  check(
    "company_asset_receipts_result_check",
    sql`(${table.status} = 'pending' and ${table.result} is null and ${table.errorCode} is null and ${table.errorRetryable} is null)
      or (${table.status} = 'completed' and ${table.result} is not null and ${table.errorCode} is null and ${table.errorRetryable} is null)
      or (${table.status} = 'failed' and ${table.result} is null and ${table.errorCode} is not null and ${table.errorRetryable} is not null)`,
  ),
  check(
    "company_asset_receipts_lease_check",
    sql`(${table.status} = 'pending' and ${table.leaseOwner} is not null and ${table.leaseExpiresAtMs} is not null and ${table.completedAtMs} is null)
      or (${table.status} in ('completed', 'failed') and ${table.leaseOwner} is null and ${table.leaseExpiresAtMs} is null and ${table.completedAtMs} is not null)`,
  ),
]);

export const memberAssetProfiles = pgTable("member_asset_profiles", {
  companyId: varchar("company_id", { length: 128 }).notNull(),
  memberId: varchar("member_id", { length: 128 }).primaryKey(),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  pendingOperationId: varchar("pending_operation_id", { length: 128 }),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("member_asset_profiles_company_member_unique").on(
    table.companyId,
    table.memberId,
  ),
  check("member_asset_profiles_revision_check", sql`${table.revision} >= 0`),
]);

export const memberAssetInstallations = pgTable("member_asset_installations", {
  companyId: varchar("company_id", { length: 128 }).notNull(),
  memberId: varchar("member_id", { length: 128 }).notNull(),
  assetId: varchar("asset_id", { length: 128 }).notNull(),
  versionId: varchar("version_id", { length: 128 }).notNull(),
  ordinal: bigint("ordinal", { mode: "number" }).notNull(),
  health: varchar("health", { length: 32 }).notNull().default("ready"),
  issueCode: varchar("issue_code", { length: 128 }),
  installedAtMs: bigint("installed_at_ms", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("member_asset_installations_member_version_unique").on(
    table.companyId,
    table.memberId,
    table.versionId,
  ),
  uniqueIndex("member_asset_installations_member_asset_unique").on(
    table.companyId,
    table.memberId,
    table.assetId,
  ),
  index("member_asset_installations_version_idx").on(table.companyId, table.versionId),
  foreignKey({
    columns: [table.companyId, table.memberId],
    foreignColumns: [memberAssetProfiles.companyId, memberAssetProfiles.memberId],
    name: "member_asset_installations_profile_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.companyId, table.assetId, table.versionId],
    foreignColumns: [
      companyAssetVersions.companyId,
      companyAssetVersions.assetId,
      companyAssetVersions.id,
    ],
    name: "member_asset_installations_version_fk",
  }).onDelete("restrict"),
  check("member_asset_installations_ordinal_check", sql`${table.ordinal} >= 0`),
  check(
    "member_asset_installations_health_check",
    sql`${table.health} in ('ready', 'degraded')`,
  ),
  check(
    "member_asset_installations_issue_check",
    sql`(${table.health} = 'ready' and ${table.issueCode} is null)
      or (${table.health} = 'degraded' and ${table.issueCode} is not null)`,
  ),
]);

export const memberAssetOperations = pgTable("member_asset_operations", {
  id: varchar("id", { length: 128 }).primaryKey(),
  companyId: varchar("company_id", { length: 128 }).notNull(),
  memberId: varchar("member_id", { length: 128 }).notNull(),
  requestedByActorId: varchar("requested_by_actor_id", { length: 128 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
  requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
  baseRevision: bigint("base_revision", { mode: "number" }).notNull(),
  requestedRevision: bigint("requested_revision", { mode: "number" }).notNull(),
  targets: jsonb("targets").$type<MemberAssetTarget[]>().notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  errorCode: varchar("error_code", { length: 128 }),
  retryable: boolean("retryable"),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  completedAtMs: bigint("completed_at_ms", { mode: "number" }),
}, (table) => [
  uniqueIndex("member_asset_operations_actor_key_unique").on(
    table.companyId,
    table.requestedByActorId,
    table.idempotencyKey,
  ),
  index("member_asset_operations_member_idx").on(
    table.companyId,
    table.memberId,
    table.createdAtMs,
  ),
  check("member_asset_operations_revision_check", sql`
    ${table.baseRevision} >= 0 and ${table.requestedRevision} = ${table.baseRevision} + 1
  `),
  check(
    "member_asset_operations_status_check",
    sql`${table.status} in ('pending', 'applying', 'applied', 'failed')`,
  ),
  check(
    "member_asset_operations_result_check",
    sql`(${table.status} in ('pending', 'applying') and ${table.errorCode} is null and ${table.retryable} is null and ${table.completedAtMs} is null)
      or (${table.status} = 'applied' and ${table.errorCode} is null and ${table.retryable} is null and ${table.completedAtMs} is not null)
      or (${table.status} = 'failed' and ${table.errorCode} is not null and ${table.retryable} is not null and ${table.completedAtMs} is not null)`,
  ),
]);
