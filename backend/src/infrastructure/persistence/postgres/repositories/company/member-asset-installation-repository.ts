import {
  type MemberAssetOperation,
  type MemberAssetOptionsResult,
  type MemberAssetProfile,
  type MemberAssetTarget,
} from "@fields/contracts/public/asset";
import type {
  RuntimeMemberAssetInstallation,
  RuntimeMemberAssetOperationCompletedInput,
} from "@fields/contracts/internal/asset";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import type {
  MemberAssetApplication,
  MemberAssetRuntimeGateway,
} from "../../../../../application/company/ports/company-assets.js";
import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";
import {
  companyAssets,
  companyAssetVersions,
  memberAssetInstallations,
  memberAssetOperations,
  memberAssetProfiles,
} from "../../schema/company/asset.js";

export const MEMBER_ASSET_ACCESS_DENIED_CODE = "MEMBER_ASSET_ACCESS_DENIED";
export const MEMBER_ASSET_TARGET_INVALID_CODE = "MEMBER_ASSET_TARGET_INVALID";
export const MEMBER_ASSET_REVISION_CONFLICT_CODE = "MEMBER_ASSET_REVISION_CONFLICT";
export const MEMBER_ASSET_OPERATION_IN_PROGRESS_CODE = "MEMBER_ASSET_OPERATION_IN_PROGRESS";
export const MEMBER_ASSET_OPERATION_NOT_FOUND_CODE = "MEMBER_ASSET_OPERATION_NOT_FOUND";
export const MEMBER_ASSET_IDEMPOTENCY_CONFLICT_CODE = "MEMBER_ASSET_IDEMPOTENCY_CONFLICT";
export const MEMBER_ASSET_CAPABILITY_CONFLICT_CODE = "MEMBER_ASSET_CAPABILITY_CONFLICT";

export class PostgresMemberAssetApplication implements MemberAssetApplication {
  constructor(
    private readonly db: BackendDatabase,
    private readonly runtime: MemberAssetRuntimeGateway,
    private readonly nowMs: () => number = Date.now,
    private readonly newOperationId: () => string = () => `member_assets_${randomUUID()}`,
  ) {}

  async current(
    companyId: string,
    requestedByActorId: string,
    memberId: string,
    authority: "human" | "self_agent" = "human",
  ): Promise<MemberAssetProfile> {
    await this.requireAuthority(
      companyId,
      requestedByActorId,
      memberId,
      authority === "self_agent" ? "self_agent" : "read",
    );
    return this.readProfile(companyId, memberId);
  }

  async options(
    companyId: string,
    requestedByActorId: string,
    memberId: string,
    input: { kind?: "plugin" | "skill" | "mcp"; search_term?: string },
    authority: "human" | "self_agent" = "human",
  ): Promise<MemberAssetOptionsResult> {
    await this.requireAuthority(
      companyId,
      requestedByActorId,
      memberId,
      authority === "self_agent" ? "self_agent" : "read",
    );
    const conditions = [
      eq(companyAssets.companyId, companyId),
      eq(companyAssets.lifecycle, "published"),
      ne(companyAssets.slug, "fields-core"),
      sql<boolean>`lower(${companyAssets.name}) <> 'fields-core'`,
    ];
    if (input.kind) conditions.push(eq(companyAssets.kind, input.kind));
    const search = input.search_term?.trim();
    if (search) {
      const term = `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      conditions.push(or(
        ilike(companyAssets.name, term),
        ilike(companyAssets.slug, term),
      )!);
    }
    const rows = await this.db.select({
      assetId: companyAssets.id,
      versionId: companyAssetVersions.id,
      kind: companyAssetVersions.kind,
      name: companyAssets.name,
      slug: companyAssetVersions.slug,
      version: companyAssetVersions.version,
    }).from(companyAssetVersions).innerJoin(
      companyAssets,
      and(
        eq(companyAssets.companyId, companyAssetVersions.companyId),
        eq(companyAssets.id, companyAssetVersions.assetId),
      ),
    ).where(and(...conditions)).orderBy(
      asc(companyAssets.kind),
      asc(companyAssets.name),
      asc(companyAssetVersions.publishedAtMs),
    );
    const current = await this.readProfile(companyId, memberId);
    const available = rows.map((row) => ({
      asset_id: row.assetId,
      version_id: row.versionId,
      kind: assetKind(row.kind),
      name: row.name,
      slug: row.slug,
      version: row.version,
    }));
    const knownVersions = new Set(available.map((item) => item.version_id));
    for (const installation of current.installations) {
      if (
        !knownVersions.has(installation.version_id)
        && (!input.kind || installation.kind === input.kind)
        && (
          !search
          || installation.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
          || installation.slug.toLocaleLowerCase().includes(search.toLocaleLowerCase())
        )
      ) {
        available.push({
          asset_id: installation.asset_id,
          version_id: installation.version_id,
          kind: installation.kind,
          name: installation.name,
          slug: installation.slug,
          version: installation.version,
        });
      }
    }
    return {
      member_id: memberId,
      items: available,
    };
  }

  async apply(input: {
    companyId: string;
    requestedByActorId: string;
    memberId: string;
    expectedRevision: number;
    installations: MemberAssetTarget[];
    idempotencyKey: string;
    authority: "human" | "self_agent";
  }): Promise<MemberAssetProfile> {
    await this.requireAuthority(
      input.companyId,
      input.requestedByActorId,
      input.memberId,
      input.authority === "self_agent" ? "self_agent" : "write",
    );
    const fingerprint = requestFingerprint(input);
    const existing = await this.idempotentOperation(
      input.companyId,
      input.requestedByActorId,
      input.idempotencyKey,
      fingerprint,
    );
    if (existing) return this.readProfile(input.companyId, input.memberId);

    const current = await this.readProfile(input.companyId, input.memberId);
    const retainedVersionIds = new Set(
      current.installations.map((installation) => installation.version_id),
    );
    const materialized = await this.resolveTargets(
      input.companyId,
      input.installations,
      retainedVersionIds,
    );
    assertNoCapabilityConflicts(materialized);
    const operationId = this.newOperationId();
    const now = this.nowMs();

    await this.db.transaction(async (transaction) => {
      const targetRows = await transaction.execute(sql<{
        id: string;
        type: string;
        status: string;
      }>`
        select id, type, status
        from actors
        where company_id = ${input.companyId} and id = ${input.memberId}
        for update
      `);
      const target = targetRows.rows[0];
      if (!target || target.type !== "agent" || target.status !== "active") {
        throw new ApplicationError(MEMBER_ASSET_TARGET_INVALID_CODE, false);
      }
      await transaction.insert(memberAssetProfiles).values({
        companyId: input.companyId,
        memberId: input.memberId,
        revision: 0,
        updatedAtMs: now,
      }).onConflictDoNothing();
      const profiles = await transaction.execute(sql<{
        revision: number;
        pending_operation_id: string | null;
      }>`
        select revision, pending_operation_id
        from member_asset_profiles
        where company_id = ${input.companyId} and member_id = ${input.memberId}
        for update
      `);
      const profile = profiles.rows[0];
      if (!profile || Number(profile.revision) !== input.expectedRevision) {
        throw new ApplicationError(MEMBER_ASSET_REVISION_CONFLICT_CODE, false);
      }
      if (profile.pending_operation_id !== null) {
        throw new ApplicationError(MEMBER_ASSET_OPERATION_IN_PROGRESS_CODE, true);
      }
      await transaction.insert(memberAssetOperations).values({
        id: operationId,
        companyId: input.companyId,
        memberId: input.memberId,
        requestedByActorId: input.requestedByActorId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        baseRevision: input.expectedRevision,
        requestedRevision: input.expectedRevision + 1,
        targets: input.installations,
        status: "pending",
        createdAtMs: now,
        updatedAtMs: now,
      });
      await transaction.update(memberAssetProfiles).set({
        pendingOperationId: operationId,
        updatedAtMs: now,
      }).where(and(
        eq(memberAssetProfiles.companyId, input.companyId),
        eq(memberAssetProfiles.memberId, input.memberId),
      ));
    });

    try {
      await this.runtime.memberAssetsApply(input.companyId, {
        member_id: input.memberId,
        operation_id: operationId,
        requested_revision: input.expectedRevision + 1,
        installations: materialized,
      });
      await this.db.update(memberAssetOperations).set({
        status: "applying",
        updatedAtMs: this.nowMs(),
      }).where(and(
        eq(memberAssetOperations.companyId, input.companyId),
        eq(memberAssetOperations.id, operationId),
        eq(memberAssetOperations.status, "pending"),
      ));
    } catch (error) {
      await this.failOperation(
        input.companyId,
        input.memberId,
        operationId,
        error instanceof ApplicationError ? error.code : "MEMBER_ASSET_RUNTIME_UNAVAILABLE",
        error instanceof ApplicationError ? error.retryable : true,
      );
    }
    return this.readProfile(input.companyId, input.memberId);
  }

  async operation(
    companyId: string,
    requestedByActorId: string,
    memberId: string,
    operationId: string,
  ): Promise<MemberAssetOperation> {
    await this.requireAuthority(companyId, requestedByActorId, memberId, "read");
    const [row] = await this.db.select().from(memberAssetOperations).where(and(
      eq(memberAssetOperations.companyId, companyId),
      eq(memberAssetOperations.memberId, memberId),
      eq(memberAssetOperations.id, operationId),
    )).limit(1);
    if (!row) throw new ApplicationError(MEMBER_ASSET_OPERATION_NOT_FOUND_CODE, false);
    return operationFromRow(row);
  }

  async complete(input: RuntimeMemberAssetOperationCompletedInput): Promise<void> {
    if (input.status === "failed") {
      await this.failOperation(
        input.identity.company_id,
        input.member_id,
        input.operation_id,
        input.error_code ?? "MEMBER_ASSET_APPLY_FAILED",
        input.retryable,
        input.completed_at_ms,
      );
      return;
    }
    await this.db.transaction(async (transaction) => {
      const rows = await transaction.execute(sql<{
        requested_revision: number;
        status: string;
      }>`
        select requested_revision, status
        from member_asset_operations
        where company_id = ${input.identity.company_id}
          and member_id = ${input.member_id}
          and id = ${input.operation_id}
        for update
      `);
      const operation = rows.rows[0];
      if (!operation) throw new ApplicationError(MEMBER_ASSET_OPERATION_NOT_FOUND_CODE, false);
      if (operation.status === "applied") return;
      if (operation.status === "failed") return;
      if (operation.status !== "pending" && operation.status !== "applying") {
        throw new ApplicationError(MEMBER_ASSET_TARGET_INVALID_CODE, false);
      }
      if (Number(operation.requested_revision) !== input.requested_revision) {
        throw new ApplicationError(MEMBER_ASSET_REVISION_CONFLICT_CODE, false);
      }
      const profiles = await transaction.execute(sql<{
        pending_operation_id: string | null;
      }>`
        select pending_operation_id
        from member_asset_profiles
        where company_id = ${input.identity.company_id}
          and member_id = ${input.member_id}
        for update
      `);
      if (profiles.rows[0]?.pending_operation_id !== input.operation_id) {
        throw new ApplicationError(MEMBER_ASSET_REVISION_CONFLICT_CODE, false);
      }
      await transaction.delete(memberAssetInstallations).where(and(
        eq(memberAssetInstallations.companyId, input.identity.company_id),
        eq(memberAssetInstallations.memberId, input.member_id),
      ));
      if (input.installations.length > 0) {
        await transaction.insert(memberAssetInstallations).values(
          input.installations.map((installation, ordinal) => ({
            companyId: input.identity.company_id,
            memberId: input.member_id,
            assetId: installation.asset_id,
            versionId: installation.version_id,
            ordinal,
            health: installation.health,
            issueCode: installation.issue_code,
            installedAtMs: input.completed_at_ms,
          })),
        );
      }
      await transaction.update(memberAssetProfiles).set({
        revision: input.requested_revision,
        pendingOperationId: null,
        updatedAtMs: input.completed_at_ms,
      }).where(and(
        eq(memberAssetProfiles.companyId, input.identity.company_id),
        eq(memberAssetProfiles.memberId, input.member_id),
        eq(memberAssetProfiles.pendingOperationId, input.operation_id),
      ));
      await transaction.update(memberAssetOperations).set({
        status: "applied",
        updatedAtMs: input.completed_at_ms,
        completedAtMs: input.completed_at_ms,
      }).where(and(
        eq(memberAssetOperations.companyId, input.identity.company_id),
        eq(memberAssetOperations.id, input.operation_id),
      ));
    });
  }

  private async readProfile(companyId: string, memberId: string): Promise<MemberAssetProfile> {
    const [profile] = await this.db.select().from(memberAssetProfiles).where(and(
      eq(memberAssetProfiles.companyId, companyId),
      eq(memberAssetProfiles.memberId, memberId),
    )).limit(1);
    if (!profile) {
      return { member_id: memberId, revision: 0, installations: [], operation: null };
    }
    const installations = await this.db.select({
      assetId: memberAssetInstallations.assetId,
      versionId: memberAssetInstallations.versionId,
      kind: companyAssetVersions.kind,
      name: companyAssets.name,
      slug: companyAssetVersions.slug,
      version: companyAssetVersions.version,
      health: memberAssetInstallations.health,
      issueCode: memberAssetInstallations.issueCode,
    }).from(memberAssetInstallations).innerJoin(
      companyAssetVersions,
      and(
        eq(companyAssetVersions.companyId, memberAssetInstallations.companyId),
        eq(companyAssetVersions.assetId, memberAssetInstallations.assetId),
        eq(companyAssetVersions.id, memberAssetInstallations.versionId),
      ),
    ).innerJoin(
      companyAssets,
      and(
        eq(companyAssets.companyId, companyAssetVersions.companyId),
        eq(companyAssets.id, companyAssetVersions.assetId),
      ),
    ).where(and(
      eq(memberAssetInstallations.companyId, companyId),
      eq(memberAssetInstallations.memberId, memberId),
    )).orderBy(asc(memberAssetInstallations.ordinal));
    const [operation] = await this.db.select().from(memberAssetOperations).where(and(
      eq(memberAssetOperations.companyId, companyId),
      eq(memberAssetOperations.memberId, memberId),
      ...(profile.pendingOperationId
        ? [eq(memberAssetOperations.id, profile.pendingOperationId)]
        : []),
    )).orderBy(desc(memberAssetOperations.createdAtMs)).limit(1);
    return {
      member_id: memberId,
      revision: profile.revision,
      installations: installations.map((row) => ({
        asset_id: row.assetId,
        version_id: row.versionId,
        kind: assetKind(row.kind),
        name: row.name,
        slug: row.slug,
        version: row.version,
        health: row.health === "degraded" ? "degraded" : "ready",
        issue_code: row.issueCode,
      })),
      operation: operation ? operationFromRow(operation) : null,
    };
  }

  private async resolveTargets(
    companyId: string,
    targets: MemberAssetTarget[],
    retainedVersionIds: ReadonlySet<string>,
  ): Promise<RuntimeMemberAssetInstallation[]> {
    if (targets.length === 0) return [];
    const versionIds = targets.map((target) => target.version_id);
    const rows = await this.db.select({
      assetId: companyAssetVersions.assetId,
      versionId: companyAssetVersions.id,
      kind: companyAssetVersions.kind,
      name: companyAssets.name,
      slug: companyAssetVersions.slug,
      version: companyAssetVersions.version,
      contentSha256: companyAssetVersions.contentSha256,
      source: companyAssetVersions.source,
      validation: companyAssetVersions.validation,
      lifecycle: companyAssets.lifecycle,
    }).from(companyAssetVersions).innerJoin(
      companyAssets,
      and(
        eq(companyAssets.companyId, companyAssetVersions.companyId),
        eq(companyAssets.id, companyAssetVersions.assetId),
      ),
    ).where(and(
      eq(companyAssetVersions.companyId, companyId),
      inArray(companyAssetVersions.id, versionIds),
    ));
    const byVersion = new Map(rows.map((row) => [row.versionId, row]));
    const seenAssets = new Set<string>();
    return targets.map((target) => {
      const row = byVersion.get(target.version_id);
      if (
        !row
        || row.assetId !== target.asset_id
        || (row.lifecycle !== "published" && !retainedVersionIds.has(row.versionId))
        || seenAssets.has(row.assetId)
      ) {
        throw new ApplicationError(MEMBER_ASSET_TARGET_INVALID_CODE, false);
      }
      seenAssets.add(row.assetId);
      return {
        asset_id: row.assetId,
        version_id: row.versionId,
        kind: assetKind(row.kind),
        name: row.name,
        slug: row.slug,
        version: row.version,
        content_sha256: row.contentSha256,
        source: row.source,
        capabilities: row.validation.capabilities,
      };
    });
  }

  private async requireAuthority(
    companyId: string,
    requesterId: string,
    memberId: string,
    mode: "read" | "write" | "self_agent",
  ): Promise<void> {
    const actorIds = requesterId === memberId ? [requesterId] : [requesterId, memberId];
    const result = await this.db.execute(sql<{
      id: string;
      type: string;
      status: string;
    }>`
      select id, type, status
      from actors
      where company_id = ${companyId}
        and id in (${sql.join(actorIds.map((id) => sql`${id}`), sql`, `)})
    `);
    const rows = result.rows;
    const requester = rows.find((row) => row.id === requesterId);
    const target = rows.find((row) => row.id === memberId);
    const allowedRequester = mode === "self_agent"
      ? requesterId === memberId && requester?.type === "agent"
      : requester?.type === "human";
    if (
      !allowedRequester
      || requester?.status !== "active"
      || target?.type !== "agent"
      || target.status !== "active"
    ) {
      throw new ApplicationError(MEMBER_ASSET_ACCESS_DENIED_CODE, false);
    }
  }

  private async idempotentOperation(
    companyId: string,
    actorId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<boolean> {
    const [row] = await this.db.select({
      requestFingerprint: memberAssetOperations.requestFingerprint,
    }).from(memberAssetOperations).where(and(
      eq(memberAssetOperations.companyId, companyId),
      eq(memberAssetOperations.requestedByActorId, actorId),
      eq(memberAssetOperations.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (!row) return false;
    if (row.requestFingerprint !== fingerprint) {
      throw new ApplicationError(MEMBER_ASSET_IDEMPOTENCY_CONFLICT_CODE, false);
    }
    return true;
  }

  private async failOperation(
    companyId: string,
    memberId: string,
    operationId: string,
    errorCode: string,
    retryable: boolean,
    completedAtMs = this.nowMs(),
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.update(memberAssetOperations).set({
        status: "failed",
        errorCode,
        retryable,
        updatedAtMs: completedAtMs,
        completedAtMs,
      }).where(and(
        eq(memberAssetOperations.companyId, companyId),
        eq(memberAssetOperations.memberId, memberId),
        eq(memberAssetOperations.id, operationId),
        inArray(memberAssetOperations.status, ["pending", "applying"]),
      ));
      await transaction.update(memberAssetProfiles).set({
        pendingOperationId: null,
        updatedAtMs: completedAtMs,
      }).where(and(
        eq(memberAssetProfiles.companyId, companyId),
        eq(memberAssetProfiles.memberId, memberId),
        eq(memberAssetProfiles.pendingOperationId, operationId),
      ));
    });
  }
}

function assetKind(value: string): "plugin" | "skill" | "mcp" {
  if (value === "plugin" || value === "skill" || value === "mcp") return value;
  throw new ApplicationError(MEMBER_ASSET_TARGET_INVALID_CODE, false);
}

function requestFingerprint(input: {
  memberId: string;
  expectedRevision: number;
  installations: MemberAssetTarget[];
}): string {
  return createHash("sha256").update(JSON.stringify({
    member_id: input.memberId,
    expected_revision: input.expectedRevision,
    installations: input.installations,
  })).digest("hex");
}

function operationFromRow(row: typeof memberAssetOperations.$inferSelect): MemberAssetOperation {
  const status = row.status;
  if (
    status !== "pending"
    && status !== "applying"
    && status !== "applied"
    && status !== "failed"
  ) {
    throw new ApplicationError(MEMBER_ASSET_TARGET_INVALID_CODE, false);
  }
  return {
    operation_id: row.id,
    status,
    requested_revision: row.requestedRevision,
    error_code: row.errorCode,
    retryable: row.retryable,
    created_at_ms: row.createdAtMs,
    updated_at_ms: row.updatedAtMs,
    completed_at_ms: row.completedAtMs,
  };
}

function assertNoCapabilityConflicts(
  installations: RuntimeMemberAssetInstallation[],
): void {
  const pluginIds = new Set<string>();
  const skillNames = new Set<string>();
  const mcpNames = new Set<string>([
    "fields",
    "fields-core",
    "fields_embodiment",
    "fields_search",
    "fields_room_messages",
    "fields_assets",
  ]);
  for (const installation of installations) {
    if (installation.kind === "plugin") {
      if (pluginIds.has(installation.slug)) conflict();
      pluginIds.add(installation.slug);
    }
    if (installation.kind === "skill") {
      if (skillNames.has(installation.slug)) conflict();
      skillNames.add(installation.slug);
    }
    if (installation.kind === "mcp") {
      if (mcpNames.has(installation.slug)) conflict();
      mcpNames.add(installation.slug);
    }
    for (const capability of installation.capabilities.entries) {
      if (capability.kind === "skill") {
        if (skillNames.has(capability.name)) conflict();
        skillNames.add(capability.name);
      }
      if (capability.kind === "mcp") {
        if (mcpNames.has(capability.name)) conflict();
        mcpNames.add(capability.name);
      }
    }
  }
}

function conflict(): never {
  throw new ApplicationError(MEMBER_ASSET_CAPABILITY_CONFLICT_CODE, false);
}
