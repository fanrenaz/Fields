import {
  assetContentSchema,
  assetDetailSchema,
  assetDraftDeleteResultSchema,
  assetDraftMutationResultSchema,
  assetListResultSchema,
  assetMutationResultSchema,
  assetMcpToolCallResultSchema,
  assetMcpToolsListResultSchema,
  assetPublishResultSchema,
  type AssetArchiveInput,
  type AssetContent,
  type AssetContentReadInput,
  type AssetDetail,
  type AssetDraft,
  type AssetDraftBeginZipInput,
  type AssetDraftCreateMcpInput,
  type AssetDraftImportGitInput,
  type AssetDraftUpdateInput,
  type AssetDraftRevisionInput,
  type AssetFileEntry,
  type AssetKind,
  type AssetListInput,
  type AssetListResult,
  type AssetMcpCredentialReplaceInput,
  type AssetMcpToolCallInput,
  type AssetMcpToolCallResult,
  type AssetMcpToolsListInput,
  type AssetMcpToolsListResult,
  type AssetSource,
  type AssetSummary,
  type AssetValidationSnapshot,
  type AssetVersionRecord,
} from "@fields/contracts/public/asset";
import type {
  AssetStoredPackage,
} from "@fields/contracts/internal/asset";
import { assetStoredPackageSchema } from "@fields/contracts/internal/asset";
import {
  and,
  desc,
  eq,
  exists,
  ilike,
  isNotNull,
  isNull,
  lt,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import {
  ASSET_ARCHIVED_CODE,
  ASSET_DRAFT_NOT_FOUND_CODE,
  ASSET_IDEMPOTENCY_CONFLICT_CODE,
  ASSET_IDENTITY_RESERVED_CODE,
  ASSET_MCP_CREDENTIAL_REQUIRED_CODE,
  ASSET_MCP_REQUIRED_CODE,
  ASSET_MCP_VERSION_INVALID_CODE,
  ASSET_NOT_FOUND_CODE,
  ASSET_REVISION_CONFLICT_CODE,
  ASSET_VALIDATION_REQUIRED_CODE,
  ASSET_VERSION_CONFLICT_CODE,
  type AssetWorkspaceZipInput,
  type CompanyAssetApplication,
  type CompanyAssetRuntimeGateway,
} from "../../../../../application/company/ports/company-assets.js";
import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";
import {
  companyAssetDrafts,
  companyAssetMutationReceipts,
  companyAssets,
  companyAssetVersionCredentials,
  companyAssetVersions,
} from "../../schema/company/asset.js";

const RESERVED_ASSET_IDENTITY = "fields-core";
const ASSET_IDEMPOTENCY_BEARER_TOKEN_DOMAIN =
  "fields.company-asset.idempotency.bearer-token.v1";
type AssetIdempotencyClaim = {
  context: Record<string, unknown>;
  result: Record<string, unknown> | null;
  leaseOwner: string | null;
  operationId: string;
  phase: string;
  requestFingerprint: string;
};

const PENDING_VALIDATION: AssetValidationSnapshot = {
  status: "pending",
  validated_at_ms: null,
  validator: null,
  issues: [],
  capabilities: { entries: [], credential_configured: false },
};

export class PostgresCompanyAssetApplication implements CompanyAssetApplication {
  constructor(
    private readonly db: BackendDatabase,
    private readonly runtime: CompanyAssetRuntimeGateway,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async list(
    companyId: string,
    _actorId: string,
    input: AssetListInput,
  ): Promise<AssetListResult> {
    const limit = input.limit ?? 50;
    const conditions = [
      eq(companyAssets.companyId, companyId),
      ne(companyAssets.slug, RESERVED_ASSET_IDENTITY),
      sql<boolean>`lower(${companyAssets.name}) <> ${RESERVED_ASSET_IDENTITY}`,
      or(
        isNotNull(companyAssets.currentVersionId),
        exists(
          this.db.select({ one: sql`1` }).from(companyAssetDrafts).where(and(
            eq(companyAssetDrafts.companyId, companyId),
            eq(companyAssetDrafts.assetId, companyAssets.id),
          )),
        ),
      )!,
    ];
    if (input.kind) conditions.push(eq(companyAssets.kind, input.kind));
    if (input.lifecycle === "draft") {
      conditions.push(ne(companyAssets.lifecycle, "archived"));
      conditions.push(exists(
        this.db.select({ one: sql`1` }).from(companyAssetDrafts).where(and(
          eq(companyAssetDrafts.companyId, companyId),
          eq(companyAssetDrafts.assetId, companyAssets.id),
        )),
      ));
    } else if (input.lifecycle) {
      conditions.push(eq(companyAssets.lifecycle, input.lifecycle));
    } else {
      conditions.push(ne(companyAssets.lifecycle, "archived"));
    }
    if (input.search_term?.trim()) {
      const term = `%${input.search_term.trim()}%`;
      const search = or(
        ilike(companyAssets.name, term),
        ilike(companyAssets.slug, term),
        ilike(companyAssets.description, term),
      );
      if (search) conditions.push(search);
    }
    if (input.cursor !== undefined && input.cursor !== null) {
      const cursor = decodeAssetCursor(input.cursor);
      const before = or(
        lt(companyAssets.updatedAtMs, cursor.updatedAtMs),
        and(
          eq(companyAssets.updatedAtMs, cursor.updatedAtMs),
          lt(companyAssets.id, cursor.id),
        ),
      );
      if (before) conditions.push(before);
    }
    const rows = await this.db.select().from(companyAssets)
      .where(and(...conditions))
      .orderBy(desc(companyAssets.updatedAtMs), desc(companyAssets.id))
      .limit(limit + 1);
    const items = await Promise.all(rows.slice(0, limit).map(async (asset) => {
      const summary = await this.summary(asset);
      return input.lifecycle === "draft"
        ? { ...summary, lifecycle: "draft" as const }
        : summary;
    }));
    return assetListResultSchema.parse({
      items,
      page: {
        next_cursor: rows.length > limit
          ? encodeAssetCursor(rows[limit - 1]!)
          : null,
      },
    });
  }

  async read(companyId: string, _actorId: string, assetId: string): Promise<AssetDetail> {
    const asset = await this.requireAsset(companyId, assetId);
    return this.detail(asset);
  }

  async contentRead(
    companyId: string,
    _actorId: string,
    input: AssetContentReadInput,
  ): Promise<AssetContent> {
    await this.requireAsset(companyId, input.asset_id);
    let digest: string | null = null;
    if (input.draft_id) {
      const draft = await this.requireDraft(companyId, input.draft_id);
      if (draft.assetId !== input.asset_id) throw new ApplicationError(ASSET_NOT_FOUND_CODE, false);
      digest = draft.contentSha256;
    } else {
      const [version] = await this.db.select().from(companyAssetVersions).where(and(
        eq(companyAssetVersions.companyId, companyId),
        eq(companyAssetVersions.assetId, input.asset_id),
        eq(companyAssetVersions.version, input.version!),
      )).limit(1);
      digest = version?.contentSha256 ?? null;
    }
    if (!digest) throw new ApplicationError("ASSET_CONTENT_NOT_FOUND", false);
    return assetContentSchema.parse(await this.runtime.assetContentRead(companyId, {
      content_sha256: digest,
      path: input.path,
    }));
  }

  async listMcpTools(
    companyId: string,
    actorId: string,
    input: AssetMcpToolsListInput,
  ): Promise<AssetMcpToolsListResult> {
    const version = await this.requireCallableMcpVersion(companyId, input.asset_id);
    const result = await this.runtime.assetMcpToolsList(companyId, {
      version_id: version.id,
      actor_id: actorId,
    });
    return assetMcpToolsListResultSchema.parse({
      asset_id: input.asset_id,
      version_id: version.id,
      tools: result.tools,
    });
  }

  async callMcpTool(
    companyId: string,
    actorId: string,
    input: AssetMcpToolCallInput,
  ): Promise<AssetMcpToolCallResult> {
    const version = await this.requireCallableMcpVersion(companyId, input.asset_id);
    if (version.id !== input.expected_version_id) {
      throw new ApplicationError(ASSET_VERSION_CONFLICT_CODE, false);
    }
    const result = await this.runtime.assetMcpToolCall(companyId, {
      version_id: version.id,
      actor_id: actorId,
      tool_name: input.tool_name,
      arguments: input.arguments,
    });
    return assetMcpToolCallResultSchema.parse({
      asset_id: input.asset_id,
      version_id: version.id,
      ...result,
    });
  }

  async beginZip(
    companyId: string,
    actorId: string,
    input: AssetDraftBeginZipInput,
  ): Promise<{ draft: AssetDraft }> {
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      "draft.begin_zip",
      input,
    );
    if (replay.result) return assetDraftMutationResultSchema.parse(replay.result);
    try {
      assertDraftKindVersion(input.kind, input.version);
      const draft = await this.createDraft(companyId, actorId, {
        draftId: mutationEntityId(
          "asset_draft",
          companyId,
          actorId,
          "draft.begin_zip",
          input.idempotency_key,
        ),
        kind: input.kind,
        name: input.name,
        slug: input.slug,
        description: input.description ?? "",
        version: input.version ?? null,
        source: { type: "zip", file_name: input.file_name },
        contentSha256: null,
        files: [],
      });
      return this.receipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.begin_zip",
        assetDraftMutationResultSchema.parse({ draft }),
        replay,
      );
    } catch (error) {
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.begin_zip",
        replay,
        error,
      );
    }
  }

  async uploadPackage(
    companyId: string,
    actorId: string,
    input: {
      draft_id: string;
      expected_revision: number;
      idempotency_key: string;
      package_sha256: string;
      package_size_bytes: number;
      package_body: AsyncIterable<Uint8Array>;
      signal?: AbortSignal;
    },
  ): Promise<{ draft: AssetDraft }> {
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      "draft.upload_package",
      {
        draft_id: input.draft_id,
        expected_revision: input.expected_revision,
        idempotency_key: input.idempotency_key,
        package_sha256: input.package_sha256,
        package_size_bytes: input.package_size_bytes,
      },
    );
    if (replay.result) return assetDraftMutationResultSchema.parse(replay.result);
    try {
      const draft = await this.requireDraft(companyId, input.draft_id);
      const packageAlreadyApplied = (
        draft.revision === input.expected_revision + 1
        && draft.contentSha256 !== null
      );
      if (!packageAlreadyApplied) this.assertRevision(draft.revision, input.expected_revision);
      if (draft.source?.type !== "zip") {
        throw new ApplicationError("ASSET_DRAFT_SOURCE_INVALID", false);
      }
      const stored = storedPackageFromClaim(replay, draft.id)
        ?? await this.runtime.assetImportZip(companyId, {
          operation_id: replay.operationId,
          request_fingerprint: replay.requestFingerprint,
          draft_id: draft.id,
          expected_content_sha256: draft.contentSha256,
          kind: draft.kind as "plugin" | "skill",
          file_name: draft.source.file_name,
          package_sha256: input.package_sha256,
          package_size_bytes: input.package_size_bytes,
        }, input.package_body, input.signal);
      let databaseCommitted = packageAlreadyApplied;
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.upload_package",
        replay,
        "runtime_staged",
        { draft_id: draft.id, stored },
      );
      try {
        if (packageAlreadyApplied) {
          if (stored.content_sha256 !== draft.contentSha256) {
            throw new ApplicationError(ASSET_IDEMPOTENCY_CONFLICT_CODE, false);
          }
          return this.receipt(
            companyId,
            actorId,
            input.idempotency_key,
            "draft.upload_package",
            assetDraftMutationResultSchema.parse({ draft: draftProjection(draft) }),
            replay,
          );
        }
        const result = assetDraftMutationResultSchema.parse({
          draft: await this.applyStoredPackage(companyId, actorId, draft, stored),
        });
        databaseCommitted = true;
        await this.advanceReceipt(
          companyId,
          actorId,
          input.idempotency_key,
          "draft.upload_package",
          replay,
          "database_committed",
          { draft_id: draft.id, stored },
        );
        return this.receipt(
          companyId,
          actorId,
          input.idempotency_key,
          "draft.upload_package",
          result,
          replay,
        );
      } catch (error) {
        if (!databaseCommitted) {
          await this.rollbackDraftReference(companyId, draft, stored.content_sha256);
        }
        throw error;
      }
    } catch (error) {
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.upload_package",
        replay,
        error,
      );
    }
  }

  async importGit(
    companyId: string,
    actorId: string,
    input: AssetDraftImportGitInput,
  ): Promise<{ draft: AssetDraft }> {
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      "draft.import_git",
      input,
    );
    if (replay.result) return assetDraftMutationResultSchema.parse(replay.result);
    const draftId = mutationEntityId(
      "asset_draft",
      companyId,
      actorId,
      "draft.import_git",
      input.idempotency_key,
    );
    let databaseCommitted = false;
    let stored: AssetStoredPackage;
    try {
      assertDraftKindVersion(input.kind, input.version);
      stored = storedPackageFromClaim(replay, draftId)
        ?? await this.runtime.assetImportGit(companyId, {
          operation_id: replay.operationId,
          request_fingerprint: replay.requestFingerprint,
          draft_id: draftId,
          expected_content_sha256: null,
          kind: input.kind,
          repository_url: input.repository_url,
          subdirectory: input.subdirectory ?? null,
        });
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.import_git",
        replay,
        "runtime_staged",
        { draft_id: draftId, stored },
      );
      const name = input.name ?? stored.inferred_name;
      const slug = input.slug ?? stored.inferred_slug;
      const version = input.kind === "plugin"
        ? stored.inferred_version
        : input.version ?? stored.inferred_version;
      if (!name || !slug) throw new ApplicationError("ASSET_METADATA_REQUIRED", false);
      const draft = await this.createDraft(companyId, actorId, {
        draftId,
        kind: input.kind,
        name,
        slug,
        description: input.description ?? "",
        version: version ?? null,
        source: stored.source,
        contentSha256: stored.content_sha256,
        files: stored.files,
      });
      databaseCommitted = true;
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.import_git",
        replay,
        "database_committed",
        { draft_id: draftId, stored },
      );
      return this.receipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.import_git",
        assetDraftMutationResultSchema.parse({ draft }),
        replay,
      );
    } catch (error) {
      if (
        error instanceof ApplicationError
        && !error.retryable
        && replay.phase === "runtime_staged"
        && !databaseCommitted
      ) {
        await this.releaseStagedDraftIfUncommitted(companyId, draftId);
      }
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.import_git",
        replay,
        error,
      );
    }
  }

  async importWorkspaceZip(
    companyId: string,
    actorId: string,
    input: AssetWorkspaceZipInput,
  ): Promise<{ draft: AssetDraft }> {
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      "draft.import_workspace_zip",
      input,
    );
    if (replay.result) return assetDraftMutationResultSchema.parse(replay.result);
    const draftId = mutationEntityId(
      "asset_draft",
      companyId,
      actorId,
      "draft.import_workspace_zip",
      input.idempotency_key,
    );
    let databaseCommitted = false;
    try {
      assertDraftKindVersion(input.kind, input.version);
      const stored = storedPackageFromClaim(replay, draftId)
        ?? await this.runtime.assetImportWorkspaceZip(companyId, {
          operation_id: replay.operationId,
          request_fingerprint: replay.requestFingerprint,
          draft_id: draftId,
          expected_content_sha256: null,
          kind: input.kind,
          member_id: actorId,
          thread_id: input.thread_id,
          workspace_relative_path: input.workspace_relative_path,
        });
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.import_workspace_zip",
        replay,
        "runtime_staged",
        { draft_id: draftId, stored },
      );
      const draft = await this.createDraft(companyId, actorId, {
        draftId,
        kind: input.kind,
        name: input.name || stored.inferred_name || input.slug,
        slug: input.slug || stored.inferred_slug || "",
        description: input.description ?? "",
        version: input.kind === "plugin"
          ? stored.inferred_version
          : input.version ?? stored.inferred_version,
        source: stored.source,
        contentSha256: stored.content_sha256,
        files: stored.files,
      });
      databaseCommitted = true;
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.import_workspace_zip",
        replay,
        "database_committed",
        { draft_id: draftId, stored },
      );
      return this.receipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.import_workspace_zip",
        assetDraftMutationResultSchema.parse({ draft }),
        replay,
      );
    } catch (error) {
      if (
        error instanceof ApplicationError
        && !error.retryable
        && replay.phase === "runtime_staged"
        && !databaseCommitted
      ) {
        await this.releaseStagedDraftIfUncommitted(companyId, draftId);
      }
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.import_workspace_zip",
        replay,
        error,
      );
    }
  }

  async createMcp(
    companyId: string,
    actorId: string,
    input: AssetDraftCreateMcpInput,
  ): Promise<{ draft: AssetDraft }> {
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      "draft.create_mcp",
      input,
    );
    if (replay.result) return assetDraftMutationResultSchema.parse(replay.result);
    const draftId = mutationEntityId(
      "asset_draft",
      companyId,
      actorId,
      "draft.create_mcp",
      input.idempotency_key,
    );
    let databaseCommitted = false;
    try {
      const stored = storedPackageFromClaim(replay, draftId)
        ?? await this.runtime.assetStoreMcp(companyId, {
          operation_id: replay.operationId,
          request_fingerprint: replay.requestFingerprint,
          draft_id: draftId,
          expected_content_sha256: null,
          endpoint_url: input.endpoint_url,
          authentication: input.authentication,
          bearer_token: input.bearer_token ?? null,
        });
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.create_mcp",
        replay,
        "runtime_staged",
        { draft_id: draftId, stored },
      );
      const draft = await this.createDraft(companyId, actorId, {
        draftId,
        kind: "mcp",
        name: input.name,
        slug: input.slug,
        description: input.description ?? "",
        version: input.version,
        source: stored.source,
        contentSha256: stored.content_sha256,
        files: stored.files,
      });
      databaseCommitted = true;
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.create_mcp",
        replay,
        "database_committed",
        { draft_id: draftId, stored },
      );
      return this.receipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.create_mcp",
        assetDraftMutationResultSchema.parse({ draft }),
        replay,
      );
    } catch (error) {
      if (
        error instanceof ApplicationError
        && !error.retryable
        && replay.phase === "runtime_staged"
        && !databaseCommitted
      ) {
        await this.releaseStagedDraftIfUncommitted(companyId, draftId);
      }
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.create_mcp",
        replay,
        error,
      );
    }
  }

  async updateDraft(
    companyId: string,
    actorId: string,
    input: AssetDraftUpdateInput,
  ): Promise<{ draft: AssetDraft }> {
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      "draft.update",
      input,
    );
    if (replay.result) return assetDraftMutationResultSchema.parse(replay.result);
    try {
      const draft = await this.requireDraft(companyId, input.draft_id);
      if (
        draft.kind !== "mcp"
      && (input.endpoint_url !== undefined || input.authentication !== undefined)
      ) {
        throw new ApplicationError("ASSET_KIND_INVALID", false);
      }
      if (draft.kind === "plugin" && input.version !== undefined) {
        throw new ApplicationError("ASSET_PLUGIN_VERSION_IMMUTABLE", false);
      }
      if (
        draft.revision === input.expected_revision + 1
      && draftMatchesUpdate(draft, input)
      ) {
        const credentialUpdateSource = (
          draft.kind === "mcp"
        && draft.source?.type === "mcp"
        && !draft.source.credential_configured
        && (input.endpoint_url !== undefined || input.authentication !== undefined)
        )
          ? draft.source
          : null;
        if (credentialUpdateSource) {
          if (draft.credentialOperationId !== replay.operationId) {
            if (
              replay.phase === "runtime_staged"
              || replay.phase === "database_committed"
            ) {
              await this.runtime.assetCredentialAbort(companyId, {
                operation_id: replay.operationId,
                request_fingerprint: replay.requestFingerprint,
              });
            }
            throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
          }
          await this.runtime.assetCredentialStage(companyId, {
            operation_id: replay.operationId,
            request_fingerprint: replay.requestFingerprint,
            target_revision: draft.revision,
            expected_operation_id: receiptCredentialPredecessor(replay),
            reference: { type: "draft", draft_id: draft.id },
            endpoint_url: credentialUpdateSource.endpoint_url,
            authentication: credentialUpdateSource.authentication,
            bearer_token: null,
          });
          await this.runtime.assetCredentialCommit(companyId, {
            operation_id: replay.operationId,
            request_fingerprint: replay.requestFingerprint,
          });
          await this.advanceReceipt(
            companyId,
            actorId,
            input.idempotency_key,
            "draft.update",
            replay,
            "runtime_committed",
            { draft_id: draft.id },
          );
        }
        return this.receipt(
          companyId,
          actorId,
          input.idempotency_key,
          "draft.update",
          assetDraftMutationResultSchema.parse({ draft: draftProjection(draft) }),
          replay,
        );
      }
      this.assertRevision(draft.revision, input.expected_revision);
      const asset = await this.requireAsset(companyId, draft.assetId);
      if (asset.lifecycle === "archived") throw new ApplicationError(ASSET_ARCHIVED_CODE, false);
      assertAssetIdentity(input.name ?? draft.name, input.slug ?? draft.slug);
      let source = draft.source;
      let contentSha256 = draft.contentSha256;
      let files = draft.files;
      let credentialStaged = false;
      if (
        draft.kind === "mcp"
      && (input.endpoint_url !== undefined || input.authentication !== undefined)
      ) {
        if (source?.type !== "mcp") throw new ApplicationError("ASSET_DRAFT_SOURCE_INVALID", false);
        const stored = await this.runtime.assetStoreMcp(companyId, {
          operation_id: replay.operationId,
          request_fingerprint: replay.requestFingerprint,
          draft_id: draft.id,
          expected_content_sha256: draft.contentSha256,
          endpoint_url: input.endpoint_url ?? source.endpoint_url,
          authentication: input.authentication ?? source.authentication,
        });
        source = stored.source;
        contentSha256 = stored.content_sha256;
        files = stored.files;
        await this.advanceReceipt(
          companyId,
          actorId,
          input.idempotency_key,
          "draft.update",
          replay,
          "runtime_staged",
          {
            draft_id: draft.id,
            stored,
            previous_credential_operation_id: draft.credentialOperationId,
          },
        );
        if (source.type === "mcp" && !source.credential_configured) {
          await this.runtime.assetCredentialStage(companyId, {
            operation_id: replay.operationId,
            request_fingerprint: replay.requestFingerprint,
            target_revision: draft.revision + 1,
            expected_operation_id: draft.credentialOperationId,
            reference: { type: "draft", draft_id: draft.id },
            endpoint_url: source.endpoint_url,
            authentication: source.authentication,
            bearer_token: null,
          });
          credentialStaged = true;
        }
      }
      const now = this.nowMs();
      let updated: DraftRow;
      try {
        updated = await this.db.transaction(async (transaction) => {
          const lockedAsset = await this.lockWritableAsset(
            transaction,
            companyId,
            draft.assetId,
          );
          const [nextDraft] = await transaction.update(companyAssetDrafts).set({
            name: input.name ?? draft.name,
            slug: input.slug ?? draft.slug,
            description: input.description ?? draft.description,
            version: input.version ?? draft.version,
            source,
            credentialOperationId: credentialStaged ? replay.operationId : undefined,
            contentSha256,
            files,
            validation: PENDING_VALIDATION,
            revision: draft.revision + 1,
            updatedByActorId: actorId,
            updatedAtMs: now,
          }).where(and(
            eq(companyAssetDrafts.id, draft.id),
            eq(companyAssetDrafts.companyId, companyId),
            eq(companyAssetDrafts.revision, input.expected_revision),
          )).returning();
          if (!nextDraft) {
            throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
          }
          if (lockedAsset.current_version_id === null) {
            const [updatedAsset] = await transaction.update(companyAssets).set({
              name: nextDraft.name,
              slug: nextDraft.slug,
              description: nextDraft.description,
              revision: sql`${companyAssets.revision} + 1`,
              updatedByActorId: actorId,
              updatedAtMs: now,
            }).where(and(
              eq(companyAssets.id, draft.assetId),
              eq(companyAssets.companyId, companyId),
              ne(companyAssets.lifecycle, "archived"),
            )).returning({ id: companyAssets.id });
            if (!updatedAsset) {
              throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
            }
          }
          return nextDraft;
        });
      } catch (error) {
        if (credentialStaged) {
          await this.runtime.assetCredentialAbort(companyId, {
            operation_id: replay.operationId,
            request_fingerprint: replay.requestFingerprint,
          });
        }
        if (contentSha256 && contentSha256 !== draft.contentSha256) {
          await this.rollbackDraftReference(companyId, draft, contentSha256);
        }
        throw error;
      }
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.update",
        replay,
        "database_committed",
        { draft_id: draft.id },
      );
      if (
        draft.kind === "mcp"
      && source?.type === "mcp"
      && !source.credential_configured
      && (input.endpoint_url !== undefined || input.authentication !== undefined)
      ) {
        await this.runtime.assetCredentialCommit(companyId, {
          operation_id: replay.operationId,
          request_fingerprint: replay.requestFingerprint,
        });
        await this.advanceReceipt(
          companyId,
          actorId,
          input.idempotency_key,
          "draft.update",
          replay,
          "runtime_committed",
          { draft_id: draft.id },
        );
      }
      return this.receipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.update",
        assetDraftMutationResultSchema.parse({ draft: draftProjection(updated) }),
        replay,
      );
    } catch (error) {
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.update",
        replay,
        error,
      );
    }
  }

  async validateDraft(
    companyId: string,
    actorId: string,
    input: AssetDraftRevisionInput,
  ): Promise<{ draft: AssetDraft }> {
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      "draft.validate",
      input,
    );
    if (replay.result) return assetDraftMutationResultSchema.parse(replay.result);
    try {
      const draft = await this.requireDraft(companyId, input.draft_id);
      const asset = await this.requireAsset(companyId, draft.assetId);
      if (
        draft.revision === input.expected_revision + 1
      && draft.validation.status !== "pending"
      ) {
        return this.receipt(
          companyId,
          actorId,
          input.idempotency_key,
          "draft.validate",
          assetDraftMutationResultSchema.parse({ draft: draftProjection(draft) }),
          replay,
        );
      }
      if (asset.lifecycle === "archived") {
        throw new ApplicationError(ASSET_ARCHIVED_CODE, false);
      }
      this.assertRevision(draft.revision, input.expected_revision);
      if (!draft.source || !draft.contentSha256) {
        throw new ApplicationError("ASSET_DRAFT_CONTENT_REQUIRED", false);
      }
      const result = await this.runtime.assetValidate(companyId, {
        operation_id: replay.operationId,
        request_fingerprint: replay.requestFingerprint,
        draft_id: draft.id,
        asset_id: draft.assetId,
        kind: draft.kind as AssetKind,
        content_sha256: draft.contentSha256,
        source: draft.source,
      });
      const updated = await this.db.transaction(async (transaction) => {
        await this.lockWritableAsset(transaction, companyId, draft.assetId);
        const [nextDraft] = await transaction.update(companyAssetDrafts).set({
          validation: result.validation,
          revision: draft.revision + 1,
          updatedByActorId: actorId,
          updatedAtMs: this.nowMs(),
        }).where(and(
          eq(companyAssetDrafts.id, draft.id),
          eq(companyAssetDrafts.companyId, companyId),
          eq(companyAssetDrafts.revision, input.expected_revision),
        )).returning();
        if (!nextDraft) {
          throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
        }
        return nextDraft;
      });
      return this.receipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.validate",
        assetDraftMutationResultSchema.parse({ draft: draftProjection(updated) }),
        replay,
      );
    } catch (error) {
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.validate",
        replay,
        error,
      );
    }
  }

  async deleteDraft(
    companyId: string,
    actorId: string,
    input: AssetDraftRevisionInput,
  ): Promise<{ deleted: true; draft_id: string }> {
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      "draft.delete",
      input,
    );
    if (replay.result) return assetDraftDeleteResultSchema.parse(replay.result);
    try {
      const [draft] = await this.db.select().from(companyAssetDrafts).where(and(
        eq(companyAssetDrafts.id, input.draft_id),
        eq(companyAssetDrafts.companyId, companyId),
      )).limit(1);
      if (!draft) {
        await this.runtime.assetReleaseDraft(companyId, {
          draft_id: input.draft_id,
        });
        const recoveredAssetId = typeof replay.context.asset_id === "string"
          ? replay.context.asset_id
          : null;
        if (recoveredAssetId) {
          await this.cleanupEmptyAsset(companyId, recoveredAssetId);
        }
        return this.receipt(
          companyId,
          actorId,
          input.idempotency_key,
          "draft.delete",
          assetDraftDeleteResultSchema.parse({
            deleted: true,
            draft_id: input.draft_id,
          }),
          replay,
        );
      }
      const asset = await this.requireAsset(companyId, draft.assetId);
      if (asset.lifecycle === "archived") {
        throw new ApplicationError(ASSET_ARCHIVED_CODE, false);
      }
      this.assertRevision(draft.revision, input.expected_revision);
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.delete",
        replay,
        "prepared",
        { draft_id: draft.id, asset_id: draft.assetId },
      );
      await this.db.transaction(async (transaction) => {
        await this.lockWritableAsset(transaction, companyId, draft.assetId);
        const [deleted] = await transaction.delete(companyAssetDrafts).where(and(
          eq(companyAssetDrafts.id, draft.id),
          eq(companyAssetDrafts.companyId, companyId),
          eq(companyAssetDrafts.revision, input.expected_revision),
        )).returning();
        if (!deleted) {
          throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
        }
      });
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.delete",
        replay,
        "database_committed",
        { draft_id: draft.id, asset_id: draft.assetId },
      );
      await this.runtime.assetReleaseDraft(companyId, { draft_id: draft.id });
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.delete",
        replay,
        "runtime_released",
        { draft_id: draft.id, asset_id: draft.assetId },
      );
      await this.cleanupEmptyAsset(companyId, draft.assetId);
      return this.receipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.delete",
        assetDraftDeleteResultSchema.parse({ deleted: true, draft_id: draft.id }),
        replay,
      );
    } catch (error) {
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "draft.delete",
        replay,
        error,
      );
    }
  }

  async publish(
    companyId: string,
    actorId: string,
    input: AssetDraftRevisionInput,
  ): Promise<{ asset: AssetDetail; published_version: AssetVersionRecord }> {
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      "publish",
      input,
    );
    if (replay.result) return assetPublishResultSchema.parse(replay.result);
    try {
      const [committed] = await this.db.select().from(companyAssetVersions).where(and(
        eq(companyAssetVersions.companyId, companyId),
        eq(companyAssetVersions.sourceDraftId, input.draft_id),
      )).limit(1);
      if (committed) {
        await this.runtime.assetReleaseDraft(companyId, { draft_id: input.draft_id });
        const detail = await this.read(companyId, actorId, committed.assetId);
        const published = detail.versions.find((version) => version.version_id === committed.id);
        if (!published) throw new ApplicationError("ASSET_PERSISTENCE_INVALID", false);
        return this.receipt(
          companyId,
          actorId,
          input.idempotency_key,
          "publish",
          assetPublishResultSchema.parse({ asset: detail, published_version: published }),
          replay,
        );
      }
      const draft = await this.requireDraft(companyId, input.draft_id);
      this.assertRevision(draft.revision, input.expected_revision);
      const asset = await this.requireAsset(companyId, draft.assetId);
      if (asset.lifecycle === "archived") throw new ApplicationError(ASSET_ARCHIVED_CODE, false);
      assertAssetIdentity(draft.name, draft.slug);
      if (
        draft.validation.status !== "valid"
      || !draft.version
      || !draft.source
      || !draft.contentSha256
      ) {
        throw new ApplicationError(ASSET_VALIDATION_REQUIRED_CODE, false);
      }
      const existingVersions = await this.db.select({ version: companyAssetVersions.version })
        .from(companyAssetVersions)
        .where(eq(companyAssetVersions.assetId, asset.id));
      if (existingVersions.some((version) => compareSemver(draft.version!, version.version) <= 0)) {
        throw new ApplicationError(ASSET_VERSION_CONFLICT_CODE, false);
      }
      const versionId = mutationEntityId(
        "asset_version",
        companyId,
        actorId,
        "publish",
        input.idempotency_key,
      );
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "publish",
        replay,
        "prepared",
        { draft_id: draft.id, asset_id: asset.id, version_id: versionId },
      );
      await this.runtime.assetPublishReference(companyId, {
        draft_id: draft.id,
        version_id: versionId,
        expected_content_sha256: draft.contentSha256,
      });
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "publish",
        replay,
        "runtime_staged",
        { draft_id: draft.id, asset_id: asset.id, version_id: versionId },
      );
      const now = this.nowMs();
      let databaseCommitted = false;
      try {
        await this.db.transaction(async (transaction) => {
          await this.lockWritableAsset(transaction, companyId, asset.id);
          await transaction.insert(companyAssetVersions).values({
            id: versionId,
            sourceDraftId: draft.id,
            assetId: asset.id,
            companyId,
            kind: draft.kind,
            slug: draft.slug,
            version: draft.version!,
            revision: 1,
            source: draft.source!,
            contentSha256: draft.contentSha256!,
            files: draft.files,
            validation: draft.validation,
            publishedByActorId: actorId,
            publishedAtMs: now,
          });
          if (draft.source!.type === "mcp") {
            await transaction.insert(companyAssetVersionCredentials).values({
              versionId,
              assetId: asset.id,
              companyId,
              revision: 1,
              credentialOperationId: draft.credentialOperationId,
              credentialConfigured: draft.source!.credential_configured,
              updatedByActorId: actorId,
              updatedAtMs: now,
            });
          }
          const [updatedAsset] = await transaction.update(companyAssets).set({
            kind: draft.kind,
            slug: draft.slug,
            name: draft.name,
            description: draft.description,
            lifecycle: "published",
            revision: asset.revision + 1,
            currentVersionId: versionId,
            updatedByActorId: actorId,
            updatedAtMs: now,
            archivedAtMs: null,
          }).where(and(
            eq(companyAssets.id, asset.id),
            eq(companyAssets.companyId, companyId),
            eq(companyAssets.revision, asset.revision),
            ne(companyAssets.lifecycle, "archived"),
          )).returning({ id: companyAssets.id });
          if (!updatedAsset) throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
          const [deletedDraft] = await transaction.delete(companyAssetDrafts).where(and(
            eq(companyAssetDrafts.id, draft.id),
            eq(companyAssetDrafts.companyId, companyId),
            eq(companyAssetDrafts.revision, input.expected_revision),
          )).returning({ id: companyAssetDrafts.id });
          if (!deletedDraft) {
            throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
          }
        });
        databaseCommitted = true;
        await this.advanceReceipt(
          companyId,
          actorId,
          input.idempotency_key,
          "publish",
          replay,
          "database_committed",
          { draft_id: draft.id, asset_id: asset.id, version_id: versionId },
        );
      } catch (error) {
        if (!databaseCommitted) {
          await this.runtime.assetReleaseVersion(companyId, { version_id: versionId });
        }
        if (error instanceof ApplicationError) throw error;
        if (isUniqueViolation(error)) {
          throw new ApplicationError(ASSET_VERSION_CONFLICT_CODE, false);
        }
        throw assetPersistenceError(error);
      }
      await this.runtime.assetReleaseDraft(companyId, { draft_id: draft.id });
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "publish",
        replay,
        "draft_released",
        { draft_id: draft.id, asset_id: asset.id, version_id: versionId },
      );
      const detail = await this.read(companyId, actorId, asset.id);
      const published = detail.versions.find((version) => version.version_id === versionId);
      if (!published) throw new ApplicationError("ASSET_PERSISTENCE_INVALID", false);
      return this.receipt(
        companyId,
        actorId,
        input.idempotency_key,
        "publish",
        assetPublishResultSchema.parse({ asset: detail, published_version: published }),
        replay,
      );
    } catch (error) {
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "publish",
        replay,
        error,
      );
    }
  }

  async archive(
    companyId: string,
    actorId: string,
    input: AssetArchiveInput,
  ): Promise<{ asset: AssetDetail }> {
    return this.setArchived(companyId, actorId, input, true);
  }

  async restore(
    companyId: string,
    actorId: string,
    input: AssetArchiveInput,
  ): Promise<{ asset: AssetDetail }> {
    return this.setArchived(companyId, actorId, input, false);
  }

  async replaceCredential(
    companyId: string,
    actorId: string,
    input: AssetMcpCredentialReplaceInput,
  ): Promise<{ asset: AssetDetail }> {
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      "mcp.credential.replace",
      input,
    );
    if (replay.result) return assetMutationResultSchema.parse(replay.result);
    try {
      const asset = await this.requireAsset(companyId, input.asset_id);
      if (asset.kind !== "mcp") throw new ApplicationError("ASSET_KIND_INVALID", false);
      const [targetVersion] = input.target.type === "version"
        ? await this.db.select().from(companyAssetVersions).where(and(
          eq(companyAssetVersions.companyId, companyId),
          eq(companyAssetVersions.assetId, asset.id),
          eq(companyAssetVersions.id, input.target.version_id),
        )).limit(1)
        : [];
      const [targetDraft] = input.target.type === "draft"
        ? await this.db.select().from(companyAssetDrafts).where(and(
          eq(companyAssetDrafts.companyId, companyId),
          eq(companyAssetDrafts.assetId, asset.id),
          eq(companyAssetDrafts.id, input.target.draft_id),
        )).limit(1)
        : [];
      if (input.target.type === "version" && !targetVersion) {
        throw new ApplicationError(ASSET_NOT_FOUND_CODE, false);
      }
      if (input.target.type === "draft" && !targetDraft) {
        throw new ApplicationError(ASSET_DRAFT_NOT_FOUND_CODE, false);
      }
      const [targetVersionCredential] = targetVersion
        ? await this.db.select().from(companyAssetVersionCredentials).where(and(
          eq(companyAssetVersionCredentials.companyId, companyId),
          eq(companyAssetVersionCredentials.assetId, asset.id),
          eq(companyAssetVersionCredentials.versionId, targetVersion.id),
        )).limit(1)
        : [];
      if (targetVersion && !targetVersionCredential) {
        throw new ApplicationError("ASSET_PERSISTENCE_INVALID", false);
      }
      const source = targetVersion
        ? versionSourceProjection(targetVersion, targetVersionCredential)
        : targetDraft?.source;
      if (!source || source.type !== "mcp") {
        throw new ApplicationError("ASSET_DRAFT_SOURCE_INVALID", false);
      }
      if (source.authentication === "none" && input.bearer_token !== null) {
        throw new ApplicationError("ASSET_CREDENTIAL_AUTH_INVALID", false);
      }
      const reference = targetVersion
        ? { type: "version" as const, version_id: targetVersion.id }
        : { type: "draft" as const, draft_id: targetDraft!.id };
      const nextSource = {
        ...source,
        credential_configured: source.authentication === "bearer" && input.bearer_token !== null,
      } satisfies Extract<AssetSource, { type: "mcp" }>;
      const targetRevision = targetVersionCredential?.revision ?? targetDraft!.revision;
      const expectedRevision = input.target.expected_revision;
      const targetCredentialOperationId = targetVersionCredential?.credentialOperationId
      ?? targetDraft?.credentialOperationId;
      const databaseCommitted = targetCredentialOperationId === replay.operationId;
      if (databaseCommitted) {
        if (
          targetRevision !== expectedRevision + 1
        || source.credential_configured !== nextSource.credential_configured
        ) {
          throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
        }
        if (replay.phase !== "database_committed" && replay.phase !== "runtime_committed") {
          await this.advanceReceipt(
            companyId,
            actorId,
            input.idempotency_key,
            "mcp.credential.replace",
            replay,
            "database_committed",
            {
              asset_id: asset.id,
              reference,
              credential_configured: nextSource.credential_configured,
            },
          );
        }
      } else {
        if (asset.lifecycle === "archived") {
          throw new ApplicationError(ASSET_ARCHIVED_CODE, false);
        }
        if (replay.phase === "database_committed" || replay.phase === "runtime_committed") {
          await this.runtime.assetCredentialAbort(companyId, {
            operation_id: replay.operationId,
            request_fingerprint: replay.requestFingerprint,
          });
          throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
        }
        if (
          replay.phase === "runtime_staged"
        && targetRevision !== expectedRevision
        ) {
          await this.runtime.assetCredentialAbort(companyId, {
            operation_id: replay.operationId,
            request_fingerprint: replay.requestFingerprint,
          });
          throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
        }
        this.assertRevision(targetRevision, expectedRevision);
        await this.runtime.assetCredentialStage(companyId, {
          operation_id: replay.operationId,
          request_fingerprint: replay.requestFingerprint,
          target_revision: expectedRevision + 1,
          expected_operation_id: targetCredentialOperationId ?? null,
          reference,
          endpoint_url: source.endpoint_url,
          authentication: source.authentication,
          bearer_token: input.bearer_token,
        });
        await this.advanceReceipt(
          companyId,
          actorId,
          input.idempotency_key,
          "mcp.credential.replace",
          replay,
          "runtime_staged",
          {
            asset_id: asset.id,
            reference,
            credential_configured: nextSource.credential_configured,
            previous_credential_operation_id: targetCredentialOperationId ?? null,
          },
        );
        try {
          await this.db.transaction(async (transaction) => {
            await this.lockWritableAsset(transaction, companyId, asset.id);
            if (targetVersion) {
              const [updated] = await transaction.update(companyAssetVersionCredentials).set({
                revision: targetVersionCredential!.revision + 1,
                credentialOperationId: replay.operationId,
                credentialConfigured: nextSource.credential_configured,
                updatedByActorId: actorId,
                updatedAtMs: this.nowMs(),
              }).where(and(
                eq(companyAssetVersionCredentials.companyId, companyId),
                eq(companyAssetVersionCredentials.assetId, asset.id),
                eq(companyAssetVersionCredentials.versionId, targetVersion.id),
                eq(companyAssetVersionCredentials.revision, expectedRevision),
              )).returning({ id: companyAssetVersionCredentials.versionId });
              if (!updated) {
                throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
              }
            } else {
              const [updated] = await transaction.update(companyAssetDrafts).set({
                source: nextSource,
                credentialOperationId: replay.operationId,
                validation: PENDING_VALIDATION,
                revision: targetDraft!.revision + 1,
                updatedByActorId: actorId,
                updatedAtMs: this.nowMs(),
              }).where(and(
                eq(companyAssetDrafts.companyId, companyId),
                eq(companyAssetDrafts.assetId, asset.id),
                eq(companyAssetDrafts.id, targetDraft!.id),
                eq(companyAssetDrafts.revision, expectedRevision),
              )).returning({ id: companyAssetDrafts.id });
              if (!updated) {
                throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
              }
            }
          });
        } catch (error) {
          await this.runtime.assetCredentialAbort(companyId, {
            operation_id: replay.operationId,
            request_fingerprint: replay.requestFingerprint,
          });
          throw error;
        }
        await this.advanceReceipt(
          companyId,
          actorId,
          input.idempotency_key,
          "mcp.credential.replace",
          replay,
          "database_committed",
          {
            asset_id: asset.id,
            reference,
            credential_configured: nextSource.credential_configured,
          },
        );
      }
      await this.runtime.assetCredentialCommit(companyId, {
        operation_id: replay.operationId,
        request_fingerprint: replay.requestFingerprint,
      });
      await this.advanceReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "mcp.credential.replace",
        replay,
        "runtime_committed",
        {
          asset_id: asset.id,
          reference,
          credential_configured: nextSource.credential_configured,
        },
      );
      const result = assetMutationResultSchema.parse({
        asset: await this.read(companyId, actorId, asset.id),
      });
      return this.receipt(
        companyId,
        actorId,
        input.idempotency_key,
        "mcp.credential.replace",
        result,
        replay,
      );
    } catch (error) {
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        "mcp.credential.replace",
        replay,
        error,
      );
    }
  }

  async searchPublished(
    companyId: string,
    query: string,
    limit: number,
    cursor?: string | null,
  ): Promise<AssetListResult> {
    const term = `%${query.trim()}%`;
    const conditions = [
      eq(companyAssets.companyId, companyId),
      eq(companyAssets.lifecycle, "published"),
      ne(companyAssets.slug, RESERVED_ASSET_IDENTITY),
      sql<boolean>`lower(${companyAssets.name}) <> ${RESERVED_ASSET_IDENTITY}`,
      or(
        ilike(companyAssets.name, term),
        ilike(companyAssets.slug, term),
        ilike(companyAssets.description, term),
      ),
    ];
    if (cursor !== undefined && cursor !== null) {
      const parsed = decodeAssetCursor(cursor);
      const before = or(
        lt(companyAssets.updatedAtMs, parsed.updatedAtMs),
        and(
          eq(companyAssets.updatedAtMs, parsed.updatedAtMs),
          lt(companyAssets.id, parsed.id),
        ),
      );
      if (before) conditions.push(before);
    }
    const rows = await this.db.select().from(companyAssets).where(and(...conditions))
      .orderBy(desc(companyAssets.updatedAtMs), desc(companyAssets.id))
      .limit(limit + 1);
    return assetListResultSchema.parse({
      items: await Promise.all(rows.slice(0, limit).map((asset) => this.summary(asset))),
      page: {
        next_cursor: rows.length > limit
          ? encodeAssetCursor(rows[limit - 1]!)
          : null,
      },
    });
  }

  private async setArchived(
    companyId: string,
    actorId: string,
    input: AssetArchiveInput,
    archived: boolean,
  ): Promise<{ asset: AssetDetail }> {
    const operation = archived ? "archive" : "restore";
    const replay = await this.replay(
      companyId,
      actorId,
      input.idempotency_key,
      operation,
      input,
    );
    if (replay.result) return assetMutationResultSchema.parse(replay.result);
    try {
      const asset = await this.requireAsset(companyId, input.asset_id);
      if (!asset.currentVersionId) throw new ApplicationError("ASSET_PUBLISH_REQUIRED", false);
      if (
        asset.revision === input.expected_revision + 1
      && asset.lifecycle === (archived ? "archived" : "published")
      ) {
        return this.receipt(
          companyId,
          actorId,
          input.idempotency_key,
          operation,
          assetMutationResultSchema.parse({
            asset: await this.read(companyId, actorId, asset.id),
          }),
          replay,
        );
      }
      this.assertRevision(asset.revision, input.expected_revision);
      const now = this.nowMs();
      const [updated] = await this.db.update(companyAssets).set({
        lifecycle: archived ? "archived" : "published",
        revision: asset.revision + 1,
        archivedAtMs: archived ? now : null,
        updatedAtMs: now,
        updatedByActorId: actorId,
      }).where(and(
        eq(companyAssets.companyId, companyId),
        eq(companyAssets.id, asset.id),
        eq(companyAssets.revision, input.expected_revision),
      )).returning({ id: companyAssets.id });
      if (!updated) throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
      const result = assetMutationResultSchema.parse({
        asset: await this.read(companyId, actorId, asset.id),
      });
      return this.receipt(
        companyId,
        actorId,
        input.idempotency_key,
        operation,
        result,
        replay,
      );
    } catch (error) {
      return this.failReceipt(
        companyId,
        actorId,
        input.idempotency_key,
        operation,
        replay,
        error,
      );
    }
  }

  private async createDraft(
    companyId: string,
    actorId: string,
    input: DraftCreation,
  ): Promise<AssetDraft> {
    assertAssetIdentity(input.name, input.slug);
    const existing = await this.findExistingDraftForCreation(companyId, actorId, input);
    if (existing) return existing;
    const match = await this.findOrCreateAsset(companyId, actorId, input);
    try {
      return await this.insertDraft(companyId, actorId, match.asset.id, input);
    } catch (error) {
      if (match.created) await this.cleanupEmptyAsset(companyId, match.asset.id);
      throw error;
    }
  }

  private async findExistingDraftForCreation(
    companyId: string,
    actorId: string,
    input: DraftCreation,
  ): Promise<AssetDraft | null> {
    if (!input.draftId) return null;
    const [existing] = await this.db.select().from(companyAssetDrafts).where(and(
      eq(companyAssetDrafts.id, input.draftId),
      eq(companyAssetDrafts.companyId, companyId),
    )).limit(1);
    if (!existing) return null;
    assertDraftCreationMatches(existing, actorId, input);
    return draftProjection(existing);
  }

  private async insertDraft(
    companyId: string,
    actorId: string,
    assetId: string,
    input: DraftCreation,
  ): Promise<AssetDraft> {
    const now = this.nowMs();
    const draftId = input.draftId ?? `asset_draft_${randomUUID()}`;
    return this.db.transaction(async (transaction) => {
      await this.lockWritableAsset(transaction, companyId, assetId);
      const [draft] = await transaction.insert(companyAssetDrafts).values({
        id: draftId,
        assetId,
        companyId,
        kind: input.kind,
        slug: input.slug,
        name: input.name,
        description: input.description,
        version: input.version,
        revision: 1,
        source: input.source,
        contentSha256: input.contentSha256,
        files: input.files,
        validation: PENDING_VALIDATION,
        createdByActorId: actorId,
        updatedByActorId: actorId,
        createdAtMs: now,
        updatedAtMs: now,
      }).onConflictDoNothing().returning();
      if (draft) return draftProjection(draft);
      const [existing] = await transaction.select().from(companyAssetDrafts).where(and(
        eq(companyAssetDrafts.id, draftId),
        eq(companyAssetDrafts.companyId, companyId),
        eq(companyAssetDrafts.assetId, assetId),
      )).limit(1);
      if (!existing) {
        throw new ApplicationError("ASSET_PERSISTENCE_INVALID", false);
      }
      assertDraftCreationMatches(existing, actorId, input);
      return draftProjection(existing);
    });
  }

  private async findOrCreateAsset(
    companyId: string,
    actorId: string,
    input: Pick<DraftCreation, "kind" | "slug" | "name" | "description">,
  ) {
    assertAssetIdentity(input.name, input.slug);
    const [existing] = await this.db.select().from(companyAssets).where(and(
      eq(companyAssets.companyId, companyId),
      eq(companyAssets.kind, input.kind),
      eq(companyAssets.slug, input.slug),
    )).limit(1);
    if (existing) {
      if (existing.lifecycle === "archived") throw new ApplicationError(ASSET_ARCHIVED_CODE, false);
      return { asset: existing, created: false as const };
    }
    const now = this.nowMs();
    try {
      const [created] = await this.db.insert(companyAssets).values({
        id: `asset_${randomUUID()}`,
        companyId,
        kind: input.kind,
        slug: input.slug,
        name: input.name,
        description: input.description,
        lifecycle: "draft",
        revision: 1,
        currentVersionId: null,
        createdByActorId: actorId,
        updatedByActorId: actorId,
        createdAtMs: now,
        updatedAtMs: now,
        archivedAtMs: null,
      }).returning();
      if (!created) throw new ApplicationError("ASSET_PERSISTENCE_INVALID", false);
      return { asset: created, created: true as const };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const [winner] = await this.db.select().from(companyAssets).where(and(
          eq(companyAssets.companyId, companyId),
          eq(companyAssets.kind, input.kind),
          eq(companyAssets.slug, input.slug),
        )).limit(1);
        if (winner) {
          if (winner.lifecycle === "archived") {
            throw new ApplicationError(ASSET_ARCHIVED_CODE, false);
          }
          return { asset: winner, created: false as const };
        }
      }
      throw assetPersistenceError(error);
    }
  }

  private async applyStoredPackage(
    companyId: string,
    actorId: string,
    draft: DraftRow,
    stored: AssetStoredPackage,
  ): Promise<AssetDraft> {
    const version = draft.kind === "plugin" ? stored.inferred_version : draft.version;
    const nextName = stored.inferred_name ?? draft.name;
    const nextSlug = stored.inferred_slug ?? draft.slug;
    assertAssetIdentity(nextName, nextSlug);
    return this.db.transaction(async (transaction) => {
      await this.lockWritableAsset(transaction, companyId, draft.assetId);
      const [updated] = await transaction.update(companyAssetDrafts).set({
        name: nextName,
        slug: nextSlug,
        version,
        source: stored.source,
        contentSha256: stored.content_sha256,
        files: stored.files,
        validation: PENDING_VALIDATION,
        revision: draft.revision + 1,
        updatedByActorId: actorId,
        updatedAtMs: this.nowMs(),
      }).where(and(
        eq(companyAssetDrafts.id, draft.id),
        eq(companyAssetDrafts.companyId, companyId),
        eq(companyAssetDrafts.revision, draft.revision),
      )).returning();
      if (!updated) throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
      return draftProjection(updated);
    });
  }

  private async rollbackDraftReference(
    companyId: string,
    draft: DraftRow,
    stagedContentSha256: string,
  ): Promise<void> {
    await this.runtime.assetDraftReferenceCas(companyId, {
      draft_id: draft.id,
      expected_content_sha256: stagedContentSha256,
      next_content_sha256: draft.contentSha256,
    });
  }

  private async detail(asset: AssetRow): Promise<AssetDetail> {
    const [drafts, versions, versionCredentials] = await Promise.all([
      this.db.select().from(companyAssetDrafts)
        .where(and(
          eq(companyAssetDrafts.companyId, asset.companyId),
          eq(companyAssetDrafts.assetId, asset.id),
        ))
        .orderBy(desc(companyAssetDrafts.updatedAtMs)),
      this.db.select().from(companyAssetVersions)
        .where(and(
          eq(companyAssetVersions.companyId, asset.companyId),
          eq(companyAssetVersions.assetId, asset.id),
        ))
        .orderBy(desc(companyAssetVersions.publishedAtMs)),
      this.db.select().from(companyAssetVersionCredentials)
        .where(and(
          eq(companyAssetVersionCredentials.companyId, asset.companyId),
          eq(companyAssetVersionCredentials.assetId, asset.id),
        )),
    ]);
    const credentialsByVersionId = new Map(versionCredentials.map((credential) => (
      [credential.versionId, credential]
    )));
    const versionProjections = versions.map((version) => (
      versionProjection(version, credentialsByVersionId.get(version.id))
    ));
    const current = versionProjections.find((version) => (
      version.version_id === asset.currentVersionId
    )) ?? null;
    return assetDetailSchema.parse({
      summary: summaryProjection(asset, drafts, current),
      current,
      drafts: drafts.map(draftProjection),
      versions: versionProjections,
      files: current
        ? versions.find((version) => version.id === current.version_id)?.files ?? []
        : drafts[0]?.files ?? [],
    });
  }

  private async summary(asset: AssetRow): Promise<AssetSummary> {
    const [drafts, currentRows, currentCredentialRows] = await Promise.all([
      this.db.select().from(companyAssetDrafts)
        .where(eq(companyAssetDrafts.assetId, asset.id)),
      asset.currentVersionId
        ? this.db.select().from(companyAssetVersions)
          .where(eq(companyAssetVersions.id, asset.currentVersionId))
          .limit(1)
        : Promise.resolve([]),
      asset.currentVersionId
        ? this.db.select().from(companyAssetVersionCredentials)
          .where(and(
            eq(companyAssetVersionCredentials.companyId, asset.companyId),
            eq(companyAssetVersionCredentials.assetId, asset.id),
            eq(companyAssetVersionCredentials.versionId, asset.currentVersionId),
          ))
          .limit(1)
        : Promise.resolve([]),
    ]);
    return summaryProjection(
      asset,
      drafts,
      currentRows[0] ? versionProjection(currentRows[0], currentCredentialRows[0]) : null,
    );
  }

  private async requireCallableMcpVersion(
    companyId: string,
    assetId: string,
  ): Promise<VersionRow> {
    const asset = await this.requireAsset(companyId, assetId);
    if (asset.kind !== "mcp") {
      throw new ApplicationError(ASSET_MCP_REQUIRED_CODE, false);
    }
    if (asset.lifecycle === "archived") {
      throw new ApplicationError(ASSET_ARCHIVED_CODE, false);
    }
    if (asset.lifecycle !== "published" || !asset.currentVersionId) {
      throw new ApplicationError("ASSET_PUBLISH_REQUIRED", false);
    }
    const [[version], [credential]] = await Promise.all([
      this.db.select().from(companyAssetVersions).where(and(
        eq(companyAssetVersions.companyId, companyId),
        eq(companyAssetVersions.assetId, assetId),
        eq(companyAssetVersions.id, asset.currentVersionId),
      )).limit(1),
      this.db.select().from(companyAssetVersionCredentials).where(and(
        eq(companyAssetVersionCredentials.companyId, companyId),
        eq(companyAssetVersionCredentials.assetId, assetId),
        eq(companyAssetVersionCredentials.versionId, asset.currentVersionId),
      )).limit(1),
    ]);
    if (!version || version.kind !== "mcp" || version.source.type !== "mcp") {
      throw new ApplicationError(ASSET_MCP_VERSION_INVALID_CODE, false);
    }
    if (version.source.authentication !== "bearer" || !credential?.credentialConfigured) {
      throw new ApplicationError(ASSET_MCP_CREDENTIAL_REQUIRED_CODE, false);
    }
    if (version.validation.status !== "valid") {
      throw new ApplicationError(ASSET_VALIDATION_REQUIRED_CODE, false);
    }
    return version;
  }

  private async requireAsset(companyId: string, assetId: string): Promise<AssetRow> {
    const [asset] = await this.db.select().from(companyAssets).where(and(
      eq(companyAssets.id, assetId),
      eq(companyAssets.companyId, companyId),
      or(
        isNotNull(companyAssets.currentVersionId),
        exists(
          this.db.select({ one: sql`1` }).from(companyAssetDrafts).where(and(
            eq(companyAssetDrafts.companyId, companyId),
            eq(companyAssetDrafts.assetId, companyAssets.id),
          )),
        ),
      ),
    )).limit(1);
    if (
      !asset
      || asset.slug === RESERVED_ASSET_IDENTITY
      || asset.name.trim().toLocaleLowerCase() === RESERVED_ASSET_IDENTITY
    ) {
      throw new ApplicationError(ASSET_NOT_FOUND_CODE, false);
    }
    return asset;
  }

  private async lockWritableAsset(
    database: DatabaseExecutor,
    companyId: string,
    assetId: string,
  ): Promise<LockedAssetRow> {
    const assets = rowsFromResult<LockedAssetRow>(await database.execute(sql`
      select id, lifecycle, slug, name, current_version_id
      from company_assets
      where id = ${assetId} and company_id = ${companyId}
      limit 2
      for update
    `));
    const asset = assets.length === 1 ? assets[0] : null;
    if (
      !asset
      || asset.slug === RESERVED_ASSET_IDENTITY
      || asset.name.trim().toLocaleLowerCase() === RESERVED_ASSET_IDENTITY
    ) {
      throw new ApplicationError(ASSET_NOT_FOUND_CODE, false);
    }
    if (asset.lifecycle === "archived") {
      throw new ApplicationError(ASSET_ARCHIVED_CODE, false);
    }
    return asset;
  }

  private async requireDraft(companyId: string, draftId: string): Promise<DraftRow> {
    const [draft] = await this.db.select().from(companyAssetDrafts).where(and(
      eq(companyAssetDrafts.id, draftId),
      eq(companyAssetDrafts.companyId, companyId),
    )).limit(1);
    if (!draft) throw new ApplicationError(ASSET_DRAFT_NOT_FOUND_CODE, false);
    return draft;
  }

  private async cleanupEmptyAsset(companyId: string, assetId: string): Promise<void> {
    await this.db.delete(companyAssets).where(and(
      eq(companyAssets.companyId, companyId),
      eq(companyAssets.id, assetId),
      isNull(companyAssets.currentVersionId),
      not(exists(
        this.db.select({ id: companyAssetDrafts.id })
          .from(companyAssetDrafts)
          .where(and(
            eq(companyAssetDrafts.companyId, companyId),
            eq(companyAssetDrafts.assetId, assetId),
          )),
      )),
    ));
  }

  private async releaseStagedDraftIfUncommitted(
    companyId: string,
    draftId: string,
  ): Promise<void> {
    const [persisted] = await this.db.select({ id: companyAssetDrafts.id })
      .from(companyAssetDrafts)
      .where(and(
        eq(companyAssetDrafts.companyId, companyId),
        eq(companyAssetDrafts.id, draftId),
      ))
      .limit(1);
    if (!persisted) {
      await this.runtime.assetReleaseDraft(companyId, { draft_id: draftId });
    }
  }

  private assertRevision(actual: number, expected: number): void {
    if (actual !== expected) throw new ApplicationError(ASSET_REVISION_CONFLICT_CODE, false);
  }

  private async replay(
    companyId: string,
    actorId: string,
    idempotencyKey: string,
    operation: string,
    request: unknown,
  ): Promise<AssetIdempotencyClaim> {
    const requestFingerprint = companyAssetMutationFingerprint(operation, request);
    const now = this.nowMs();
    const leaseOwner = `asset_lease_${randomUUID()}`;
    const leaseExpiresAtMs = now + 5 * 60_000;
    const operationId = mutationEntityId(
      "asset_receipt",
      companyId,
      actorId,
      operation,
      idempotencyKey,
    );
    const [inserted] = await this.db.insert(companyAssetMutationReceipts).values({
      id: operationId,
      companyId,
      actorId,
      idempotencyKey,
      operation,
      requestFingerprint,
      status: "pending",
      phase: "claimed",
      context: {},
      result: null,
      leaseOwner,
      leaseExpiresAtMs,
      createdAtMs: now,
      updatedAtMs: now,
      completedAtMs: null,
    }).onConflictDoNothing().returning({ id: companyAssetMutationReceipts.id });
    if (inserted) {
      return {
        context: {},
        result: null,
        leaseOwner,
        operationId,
        phase: "claimed",
        requestFingerprint,
      };
    }
    const [receipt] = await this.db.select().from(companyAssetMutationReceipts).where(and(
      eq(companyAssetMutationReceipts.companyId, companyId),
      eq(companyAssetMutationReceipts.actorId, actorId),
      eq(companyAssetMutationReceipts.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (
      !receipt
      || receipt.operation !== operation
      || receipt.requestFingerprint !== requestFingerprint
    ) {
      throw new ApplicationError(ASSET_IDEMPOTENCY_CONFLICT_CODE, false);
    }
    if (receipt.status === "completed" && receipt.result) {
      return {
        context: receipt.context,
        result: receipt.result,
        leaseOwner: null,
        operationId: receipt.id,
        phase: receipt.phase,
        requestFingerprint,
      };
    }
    if (receipt.status === "failed" && receipt.errorCode) {
      throw new ApplicationError(
        receipt.errorCode,
        receipt.errorRetryable ?? false,
      );
    }
    const [reclaimed] = await this.db.update(companyAssetMutationReceipts).set({
      leaseOwner,
      leaseExpiresAtMs,
      updatedAtMs: now,
    }).where(and(
      eq(companyAssetMutationReceipts.id, receipt.id),
      eq(companyAssetMutationReceipts.status, "pending"),
      lt(companyAssetMutationReceipts.leaseExpiresAtMs, now),
    )).returning({ id: companyAssetMutationReceipts.id });
    if (!reclaimed) {
      throw new ApplicationError("ASSET_IDEMPOTENCY_IN_PROGRESS", true);
    }
    return {
      context: receipt.context,
      result: null,
      leaseOwner,
      operationId: receipt.id,
      phase: receipt.phase,
      requestFingerprint,
    };
  }

  private async receipt<T extends Record<string, unknown>>(
    companyId: string,
    actorId: string,
    idempotencyKey: string,
    operation: string,
    result: T,
    claim: AssetIdempotencyClaim,
  ): Promise<T> {
    try {
      if (!claim.leaseOwner) {
        throw new ApplicationError(ASSET_IDEMPOTENCY_CONFLICT_CODE, false);
      }
      const now = this.nowMs();
      const [completed] = await this.db.update(companyAssetMutationReceipts).set({
        status: "completed",
        phase: "completed",
        result,
        leaseOwner: null,
        leaseExpiresAtMs: null,
        updatedAtMs: now,
        completedAtMs: now,
      }).where(and(
        eq(companyAssetMutationReceipts.companyId, companyId),
        eq(companyAssetMutationReceipts.actorId, actorId),
        eq(companyAssetMutationReceipts.idempotencyKey, idempotencyKey),
        eq(companyAssetMutationReceipts.operation, operation),
        eq(companyAssetMutationReceipts.requestFingerprint, claim.requestFingerprint),
        eq(companyAssetMutationReceipts.status, "pending"),
        eq(companyAssetMutationReceipts.leaseOwner, claim.leaseOwner),
      )).returning({ result: companyAssetMutationReceipts.result });
      if (completed?.result) return completed.result as T;
      const [existing] = await this.db.select({
        operation: companyAssetMutationReceipts.operation,
        result: companyAssetMutationReceipts.result,
      }).from(companyAssetMutationReceipts).where(and(
        eq(companyAssetMutationReceipts.companyId, companyId),
        eq(companyAssetMutationReceipts.actorId, actorId),
        eq(companyAssetMutationReceipts.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (existing?.operation === operation && existing.result) return existing.result as T;
      throw new ApplicationError(ASSET_IDEMPOTENCY_CONFLICT_CODE, false);
    } catch (error) {
      throw assetPersistenceError(error);
    }
  }

  private async advanceReceipt(
    companyId: string,
    actorId: string,
    idempotencyKey: string,
    operation: string,
    claim: AssetIdempotencyClaim,
    phase: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    if (!claim.leaseOwner) {
      throw new ApplicationError(ASSET_IDEMPOTENCY_CONFLICT_CODE, false);
    }
    const now = this.nowMs();
    const [updated] = await this.db.update(companyAssetMutationReceipts).set({
      phase,
      context,
      leaseExpiresAtMs: now + 5 * 60_000,
      updatedAtMs: now,
    }).where(and(
      eq(companyAssetMutationReceipts.companyId, companyId),
      eq(companyAssetMutationReceipts.actorId, actorId),
      eq(companyAssetMutationReceipts.idempotencyKey, idempotencyKey),
      eq(companyAssetMutationReceipts.operation, operation),
      eq(companyAssetMutationReceipts.requestFingerprint, claim.requestFingerprint),
      eq(companyAssetMutationReceipts.status, "pending"),
      eq(companyAssetMutationReceipts.leaseOwner, claim.leaseOwner),
    )).returning({ id: companyAssetMutationReceipts.id });
    if (!updated) throw new ApplicationError(ASSET_IDEMPOTENCY_CONFLICT_CODE, false);
    claim.phase = phase;
    claim.context = context;
  }

  private async failReceipt(
    companyId: string,
    actorId: string,
    idempotencyKey: string,
    operation: string,
    claim: AssetIdempotencyClaim,
    error: unknown,
  ): Promise<never> {
    if (!(error instanceof ApplicationError) || error.retryable || !claim.leaseOwner) {
      throw error;
    }
    const now = this.nowMs();
    const [failed] = await this.db.update(companyAssetMutationReceipts).set({
      status: "failed",
      phase: "failed",
      result: null,
      errorCode: error.code,
      errorRetryable: false,
      leaseOwner: null,
      leaseExpiresAtMs: null,
      updatedAtMs: now,
      completedAtMs: now,
    }).where(and(
      eq(companyAssetMutationReceipts.companyId, companyId),
      eq(companyAssetMutationReceipts.actorId, actorId),
      eq(companyAssetMutationReceipts.idempotencyKey, idempotencyKey),
      eq(companyAssetMutationReceipts.operation, operation),
      eq(companyAssetMutationReceipts.requestFingerprint, claim.requestFingerprint),
      eq(companyAssetMutationReceipts.status, "pending"),
      eq(companyAssetMutationReceipts.leaseOwner, claim.leaseOwner),
    )).returning({ errorCode: companyAssetMutationReceipts.errorCode });
    if (!failed) {
      throw new ApplicationError(ASSET_IDEMPOTENCY_CONFLICT_CODE, false);
    }
    throw error;
  }
}

type AssetRow = typeof companyAssets.$inferSelect;
type DraftRow = typeof companyAssetDrafts.$inferSelect;
type VersionRow = typeof companyAssetVersions.$inferSelect;
type VersionCredentialRow = typeof companyAssetVersionCredentials.$inferSelect;
type DatabaseExecutor = Pick<BackendDatabase, "execute">;
type LockedAssetRow = {
  id: string;
  lifecycle: string;
  slug: string;
  name: string;
  current_version_id: string | null;
};

type DraftCreation = {
  draftId?: string;
  kind: AssetKind;
  name: string;
  slug: string;
  description: string;
  version: string | null;
  source: AssetSource | null;
  contentSha256: string | null;
  files: AssetFileEntry[];
};

function assertDraftCreationMatches(
  existing: DraftRow,
  actorId: string,
  input: DraftCreation,
): void {
  if (
    existing.kind !== input.kind
    || existing.slug !== input.slug
    || existing.name !== input.name
    || existing.description !== input.description
    || existing.version !== input.version
    || existing.contentSha256 !== input.contentSha256
    || existing.revision !== 1
    || existing.createdByActorId !== actorId
    || existing.updatedByActorId !== actorId
    || stableJson(existing.source) !== stableJson(input.source)
    || stableJson(existing.files) !== stableJson(input.files)
    || stableJson(existing.validation) !== stableJson(PENDING_VALIDATION)
  ) {
    throw new ApplicationError("ASSET_PERSISTENCE_INVALID", false);
  }
}

function draftProjection(draft: DraftRow): AssetDraft {
  return {
    draft_id: draft.id,
    asset_id: draft.assetId,
    kind: draft.kind as AssetKind,
    name: draft.name,
    slug: draft.slug,
    description: draft.description,
    version: draft.version,
    revision: draft.revision,
    source: draft.source,
    content_sha256: draft.contentSha256,
    files: draft.files,
    validation: draft.validation,
    created_by_actor_id: draft.createdByActorId,
    updated_by_actor_id: draft.updatedByActorId,
    created_at_ms: draft.createdAtMs,
    updated_at_ms: draft.updatedAtMs,
  };
}

function versionProjection(
  version: VersionRow,
  credential?: VersionCredentialRow,
): AssetVersionRecord {
  const source = versionSourceProjection(version, credential);
  const validation = credential && version.source.type === "mcp"
    ? {
      ...version.validation,
      capabilities: {
        ...version.validation.capabilities,
        credential_configured: credential.credentialConfigured,
      },
    }
    : version.validation;
  return {
    version_id: version.id,
    revision: credential?.revision ?? version.revision,
    version: version.version,
    source,
    content_sha256: version.contentSha256,
    files: version.files,
    validation,
    published_by_actor_id: version.publishedByActorId,
    published_at_ms: version.publishedAtMs,
  };
}

function versionSourceProjection(
  version: VersionRow,
  credential?: VersionCredentialRow,
): AssetSource {
  return credential && version.source.type === "mcp"
    ? {
      ...version.source,
      credential_configured: credential.credentialConfigured,
    }
    : version.source;
}

function summaryProjection(
  asset: AssetRow,
  drafts: DraftRow[],
  current: AssetVersionRecord | null,
): AssetSummary {
  return {
    asset_id: asset.id,
    kind: asset.kind as AssetKind,
    name: asset.name,
    slug: asset.slug,
    description: asset.description,
    lifecycle: asset.lifecycle as AssetSummary["lifecycle"],
    revision: asset.revision,
    current_version: current?.version ?? null,
    draft_count: drafts.length,
    validation_status: current?.validation.status
      ?? drafts[0]?.validation.status
      ?? "pending",
    updated_at_ms: asset.updatedAtMs,
  };
}

function compareSemver(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index]! !== rightParts[index]!) {
      return leftParts[index]! - rightParts[index]!;
    }
  }
  return 0;
}

function draftMatchesUpdate(draft: DraftRow, input: AssetDraftUpdateInput): boolean {
  if (
    input.name !== undefined && draft.name !== input.name
    || input.slug !== undefined && draft.slug !== input.slug
    || input.description !== undefined && draft.description !== input.description
    || input.version !== undefined && draft.version !== input.version
  ) {
    return false;
  }
  if (input.endpoint_url !== undefined || input.authentication !== undefined) {
    return draft.source?.type === "mcp"
      && (input.endpoint_url === undefined || draft.source.endpoint_url === input.endpoint_url)
      && (
        input.authentication === undefined
        || draft.source.authentication === input.authentication
      );
  }
  return true;
}

function storedPackageFromClaim(
  claim: AssetIdempotencyClaim,
  draftId: string,
): AssetStoredPackage | null {
  if (
    ![
      "runtime_staged",
      "database_committed",
    ].includes(claim.phase)
    || claim.context.draft_id !== draftId
    || claim.context.stored === undefined
  ) {
    return null;
  }
  const parsed = assetStoredPackageSchema.safeParse(claim.context.stored);
  if (!parsed.success) {
    throw new ApplicationError("ASSET_IDEMPOTENCY_STATE_INVALID", false);
  }
  return parsed.data;
}

function receiptCredentialPredecessor(
  claim: AssetIdempotencyClaim,
): string | null {
  const value = claim.context.previous_credential_operation_id;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new ApplicationError("ASSET_IDEMPOTENCY_STATE_INVALID", false);
  }
  return value;
}

function assertAssetIdentity(name: string, slug: string): void {
  if (
    slug === RESERVED_ASSET_IDENTITY
    || name.trim().toLocaleLowerCase() === RESERVED_ASSET_IDENTITY
  ) {
    throw new ApplicationError(ASSET_IDENTITY_RESERVED_CODE, false);
  }
}

function assertDraftKindVersion(
  kind: "plugin" | "skill",
  version: string | null | undefined,
): void {
  if (kind === "plugin" && version !== null && version !== undefined) {
    throw new ApplicationError("ASSET_PLUGIN_VERSION_IMMUTABLE", false);
  }
  if (kind === "skill" && !version) {
    throw new ApplicationError("ASSET_VERSION_REQUIRED", false);
  }
}

function encodeAssetCursor(asset: Pick<AssetRow, "id" | "updatedAtMs">): string {
  return Buffer.from(JSON.stringify({
    id: asset.id,
    updated_at_ms: asset.updatedAtMs,
  })).toString("base64url");
}

function decodeAssetCursor(cursor: string): { id: string; updatedAtMs: number } {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof value !== "object"
      || value === null
      || !("id" in value)
      || !("updated_at_ms" in value)
      || typeof value.id !== "string"
      || value.id.length === 0
      || typeof value.updated_at_ms !== "number"
      || !Number.isSafeInteger(value.updated_at_ms)
      || value.updated_at_ms < 0
    ) {
      throw new Error("invalid cursor");
    }
    return { id: value.id, updatedAtMs: value.updated_at_ms };
  } catch {
    throw new ApplicationError("ASSET_CURSOR_INVALID", false);
  }
}

function assetPersistenceError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  return new ApplicationError("ASSET_PERSISTENCE_UNAVAILABLE", true);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "23505"
  );
}

function rowsFromResult<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (
    result
    && typeof result === "object"
    && "rows" in result
    && Array.isArray(result.rows)
  ) {
    return result.rows as Row[];
  }
  return [];
}

export function companyAssetMutationFingerprint(
  operation: string,
  request: unknown,
): string {
  return createHash("sha256")
    .update(operation)
    .update("\0")
    .update(stableJson(request))
    .digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Buffer.isBuffer(value)) {
    return JSON.stringify({ sha256: createHash("sha256").update(value).digest("hex") });
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => (
      key === "bearer_token"
        ? `${JSON.stringify(key)}:${stableJson(bearerTokenFingerprintMaterial(item))}`
        : `${JSON.stringify(key)}:${stableJson(item)}`
    ))
    .join(",")}}`;
}

function bearerTokenFingerprintMaterial(value: unknown): Record<string, unknown> {
  if (value === undefined) return { state: "undefined" };
  if (value === null) return { state: "null" };
  if (typeof value !== "string") return { state: "invalid", type: typeof value };
  return {
    state: "present",
    digest: createHash("sha256")
      .update(ASSET_IDEMPOTENCY_BEARER_TOKEN_DOMAIN)
      .update("\0")
      .update(value)
      .digest("hex"),
  };
}

function mutationEntityId(
  prefix: string,
  companyId: string,
  actorId: string,
  operation: string,
  idempotencyKey: string,
): string {
  return `${prefix}_${createHash("sha256")
    .update(companyId)
    .update("\0")
    .update(actorId)
    .update("\0")
    .update(operation)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 48)}`;
}
