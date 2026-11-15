import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { and, eq, sql } from "drizzle-orm";

import {
  PostgresCompanyAssetApplication,
} from "../src/infrastructure/persistence/postgres/repositories/company/company-asset-repository.js";
import {
  ASSET_ARCHIVED_CODE,
  ASSET_IDENTITY_RESERVED_CODE,
  ASSET_MCP_CREDENTIAL_REQUIRED_CODE,
  ASSET_NOT_FOUND_CODE,
  ASSET_REVISION_CONFLICT_CODE,
  ASSET_VERSION_CONFLICT_CODE,
  type CompanyAssetRuntimeGateway,
} from "../src/application/company/ports/company-assets.js";
import { ApplicationError } from "../src/application/platform/errors.js";
import { createBackendDatabaseService } from "../src/infrastructure/persistence/postgres/database-service.js";
import { companies } from "../src/infrastructure/persistence/postgres/schema/company.js";
import {
  companyAssetDrafts,
  companyAssetMutationReceipts,
  companyAssetVersionCredentials,
  companyAssetVersions,
} from "../src/infrastructure/persistence/postgres/schema/company/asset.js";

const databaseUrl = process.env.FIELDS_INTEGRATION_DATABASE_URL?.trim();
const enabled = process.env.FIELDS_RUN_COMPANY_ASSETS_INTEGRATION_TESTS === "1"
  && Boolean(databaseUrl);
const realDependencySkip = enabled
  ? false
  : "Set FIELDS_RUN_COMPANY_ASSETS_INTEGRATION_TESTS=1 and FIELDS_INTEGRATION_DATABASE_URL.";

test("real PostgreSQL owns isolated Plugin, Skill, and MCP draft/version lifecycles", {
  skip: realDependencySkip,
}, async () => {
  const database = createBackendDatabaseService({ databaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_asset_company_${suffix}`;
  const otherCompanyId = `it_asset_other_${suffix}`;
  const actorId = `it_asset_actor_${suffix}`;
  let now = Date.now();
  const digest = "a".repeat(64);
  const validation = {
    status: "valid" as const,
    validated_at_ms: now,
    validator: "integration",
    issues: [],
    capabilities: { entries: [], credential_configured: false },
  };
  let zipImportBarrier: {
    started: () => void;
    release: Promise<void>;
  } | null = null;
  const runtime: CompanyAssetRuntimeGateway = {
    assetImportZip: async (_companyId, input) => {
      const barrier = zipImportBarrier;
      if (barrier) {
        barrier.started();
        await barrier.release;
      }
      return {
        content_sha256: digest,
        source: { type: "zip" as const, file_name: input.file_name },
        inferred_name: input.kind === "plugin" ? "Plugin One" : "Skill One",
        inferred_slug: input.kind === "plugin" ? "plugin-one" : "skill-one",
        inferred_version: input.kind === "plugin" ? "1.0.0" : null,
        files: [{
          path: input.kind === "plugin" ? ".codex-plugin/plugin.json" : "SKILL.md",
          type: "file" as const,
          size_bytes: 1,
          sha256: digest,
        }],
      };
    },
    assetImportGit: async () => { throw new Error("not used"); },
    assetImportWorkspaceZip: async () => { throw new Error("not used"); },
    assetStoreMcp: async (_companyId, input) => ({
      content_sha256: digest,
      source: {
        type: "mcp" as const,
        endpoint_url: input.endpoint_url,
        authentication: input.authentication,
        credential_configured: input.bearer_token !== undefined && input.bearer_token !== null,
      },
      inferred_name: null,
      inferred_slug: null,
      inferred_version: null,
      files: [{
        path: "mcp.json",
        type: "file" as const,
        size_bytes: 1,
        sha256: digest,
      }],
    }),
    assetValidate: async () => ({ validation, capabilities: validation.capabilities }),
    assetContentRead: async () => { throw new Error("not used"); },
    assetPublishReference: async () => undefined,
    assetReleaseDraft: async () => undefined,
    assetDraftReferenceCas: async () => undefined,
    assetReleaseVersion: async () => undefined,
    assetCredentialStage: async () => undefined,
    assetCredentialCommit: async () => undefined,
    assetCredentialAbort: async () => undefined,
    assetMcpToolsList: async () => ({ tools: [] }),
    assetMcpToolCall: async (_companyId, input) => ({
      tool_name: input.tool_name,
      is_error: false,
      text: [],
      structured_content: null,
    }),
  };
  const assets = new PostgresCompanyAssetApplication(database.db, runtime, () => ++now);
  try {
    await database.db.execute(sql`
      insert into companies (id, name, status, created_at_ms, updated_at_ms)
      values
        (${companyId}, 'Asset integration', 'active', ${now}, ${now}),
        (${otherCompanyId}, 'Asset isolation', 'active', ${now}, ${now})
    `);

    assert.deepEqual(await assets.list(companyId, actorId, { limit: 20 }), {
      items: [],
      page: { next_cursor: null },
    });

    const pluginStarted = await assets.beginZip(companyId, actorId, {
      kind: "plugin",
      name: "Plugin One",
      slug: "plugin-one",
      version: null,
      file_name: "plugin.zip",
      idempotency_key: "plugin-start",
    });
    const pluginPackage = Buffer.from("plugin");
    const pluginUploaded = await assets.uploadPackage(
      companyId,
      actorId,
      {
        draft_id: pluginStarted.draft.draft_id,
        expected_revision: pluginStarted.draft.revision,
        idempotency_key: "plugin-upload",
        package_sha256: createHash("sha256").update(pluginPackage).digest("hex"),
        package_size_bytes: pluginPackage.byteLength,
        package_body: body(pluginPackage),
      },
    );
    const pluginValidated = await assets.validateDraft(companyId, actorId, {
      draft_id: pluginUploaded.draft.draft_id,
      expected_revision: pluginUploaded.draft.revision,
      idempotency_key: "plugin-validate",
    });
    const pluginPublished = await assets.publish(companyId, actorId, {
      draft_id: pluginValidated.draft.draft_id,
      expected_revision: pluginValidated.draft.revision,
      idempotency_key: "plugin-publish",
    });

    const skillStarted = await assets.beginZip(companyId, actorId, {
      kind: "skill",
      name: "Skill One",
      slug: "skill-one",
      version: "2.0.0",
      file_name: "skill.zip",
      idempotency_key: "skill-start",
    });
    const skillPackage = Buffer.from("skill");
    const skillUploaded = await assets.uploadPackage(
      companyId,
      actorId,
      {
        draft_id: skillStarted.draft.draft_id,
        expected_revision: skillStarted.draft.revision,
        idempotency_key: "skill-upload",
        package_sha256: createHash("sha256").update(skillPackage).digest("hex"),
        package_size_bytes: skillPackage.byteLength,
        package_body: body(skillPackage),
      },
    );
    const skillValidated = await assets.validateDraft(companyId, actorId, {
      draft_id: skillUploaded.draft.draft_id,
      expected_revision: skillUploaded.draft.revision,
      idempotency_key: "skill-validate",
    });
    await assets.publish(companyId, actorId, {
      draft_id: skillValidated.draft.draft_id,
      expected_revision: skillValidated.draft.revision,
      idempotency_key: "skill-publish",
    });

    const mcpCreated = await assets.createMcp(companyId, actorId, {
      name: "MCP One",
      slug: "mcp-one",
      version: "3.0.0",
      endpoint_url: "https://example.com/mcp",
      authentication: "none",
      idempotency_key: "mcp-create",
    });
    const mcpUpdated = await assets.updateDraft(companyId, actorId, {
      draft_id: mcpCreated.draft.draft_id,
      expected_revision: mcpCreated.draft.revision,
      description: "Updated",
      idempotency_key: "mcp-update",
    });
    const mcpValidated = await assets.validateDraft(companyId, actorId, {
      draft_id: mcpUpdated.draft.draft_id,
      expected_revision: mcpUpdated.draft.revision,
      idempotency_key: "mcp-validate",
    });
    const mcpPublished = await assets.publish(companyId, actorId, {
      draft_id: mcpValidated.draft.draft_id,
      expected_revision: mcpValidated.draft.revision,
      idempotency_key: "mcp-publish",
    });

    assert.deepEqual(
      (await assets.list(companyId, actorId, { lifecycle: "published", limit: 20 }))
        .items.map((item) => item.kind).sort(),
      ["mcp", "plugin", "skill"],
    );
    assert.equal((await assets.searchPublished(companyId, "One", 2)).items.length, 2);

    await assert.rejects(
      assets.read(otherCompanyId, actorId, pluginPublished.asset.summary.asset_id),
      (error: unknown) => error instanceof ApplicationError && error.code === ASSET_NOT_FOUND_CODE,
    );
    await assert.rejects(
      assets.createMcp(companyId, actorId, {
        name: "Fields-Core",
        slug: "other",
        version: "1.0.0",
        endpoint_url: "https://example.com/mcp",
        authentication: "none",
        idempotency_key: "reserved",
      }),
      (error: unknown) => (
        error instanceof ApplicationError && error.code === ASSET_IDENTITY_RESERVED_CODE
      ),
    );

    const nextPluginDraft = await assets.beginZip(companyId, actorId, {
      kind: "plugin",
      name: "Plugin One",
      slug: "plugin-one",
      version: null,
      file_name: "plugin-next.zip",
      idempotency_key: "plugin-next-start",
    });
    const nextPluginPackage = Buffer.from("plugin-next");
    const nextPluginUploaded = await assets.uploadPackage(companyId, actorId, {
      draft_id: nextPluginDraft.draft.draft_id,
      expected_revision: nextPluginDraft.draft.revision,
      idempotency_key: "plugin-next-upload",
      package_sha256: createHash("sha256").update(nextPluginPackage).digest("hex"),
      package_size_bytes: nextPluginPackage.byteLength,
      package_body: body(nextPluginPackage),
    });
    const racingPluginDraft = await assets.beginZip(companyId, actorId, {
      kind: "plugin",
      name: "Plugin One",
      slug: "plugin-one",
      version: null,
      file_name: "plugin-racing.zip",
      idempotency_key: "plugin-racing-start",
    });
    const racingPluginPackage = Buffer.from("plugin-racing");
    const importStarted = deferred();
    const releaseImport = deferred();
    zipImportBarrier = {
      started: importStarted.resolve,
      release: releaseImport.promise,
    };
    const racingUpload = assets.uploadPackage(companyId, actorId, {
      draft_id: racingPluginDraft.draft.draft_id,
      expected_revision: racingPluginDraft.draft.revision,
      idempotency_key: "plugin-racing-upload",
      package_sha256: createHash("sha256").update(racingPluginPackage).digest("hex"),
      package_size_bytes: racingPluginPackage.byteLength,
      package_body: body(racingPluginPackage),
    });
    await importStarted.promise;
    const pluginBeforeArchive = await assets.read(
      companyId,
      actorId,
      pluginPublished.asset.summary.asset_id,
    );
    const archived = await (async () => {
      try {
        return await assets.archive(companyId, actorId, {
          asset_id: pluginPublished.asset.summary.asset_id,
          expected_revision: pluginBeforeArchive.summary.revision,
          idempotency_key: "plugin-archive",
        });
      } finally {
        zipImportBarrier = null;
        releaseImport.resolve();
      }
    })();
    await assert.rejects(racingUpload, applicationError(ASSET_ARCHIVED_CODE));
    assert.equal(archived.asset.summary.lifecycle, "archived");
    assert.equal((await assets.searchPublished(companyId, "Plugin", 10)).items.length, 0);
    await assert.rejects(
      assets.validateDraft(companyId, actorId, {
        draft_id: nextPluginUploaded.draft.draft_id,
        expected_revision: nextPluginUploaded.draft.revision,
        idempotency_key: "plugin-archived-validate",
      }),
      applicationError(ASSET_ARCHIVED_CODE),
    );
    await assert.rejects(
      assets.deleteDraft(companyId, actorId, {
        draft_id: nextPluginUploaded.draft.draft_id,
        expected_revision: nextPluginUploaded.draft.revision,
        idempotency_key: "plugin-archived-delete",
      }),
      applicationError(ASSET_ARCHIVED_CODE),
    );
    const restored = await assets.restore(companyId, actorId, {
      asset_id: pluginPublished.asset.summary.asset_id,
      expected_revision: archived.asset.summary.revision,
      idempotency_key: "plugin-restore",
    });
    assert.equal(restored.asset.summary.lifecycle, "published");

    const archivedMcp = await assets.archive(companyId, actorId, {
      asset_id: mcpPublished.asset.summary.asset_id,
      expected_revision: mcpPublished.asset.summary.revision,
      idempotency_key: "mcp-archive",
    });
    await assert.rejects(
      assets.replaceCredential(companyId, actorId, {
        asset_id: mcpPublished.asset.summary.asset_id,
        target: {
          type: "version",
          version_id: mcpPublished.published_version.version_id,
          expected_revision: mcpPublished.published_version.revision,
        },
        bearer_token: null,
        idempotency_key: "mcp-archived-credential",
      }),
      applicationError(ASSET_ARCHIVED_CODE),
    );
    await assets.restore(companyId, actorId, {
      asset_id: mcpPublished.asset.summary.asset_id,
      expected_revision: archivedMcp.asset.summary.revision,
      idempotency_key: "mcp-restore",
    });
  } finally {
    await database.db.execute(sql`
      delete from companies where id in (${companyId}, ${otherCompanyId})
    `).catch(() => undefined);
    await database.close();
  }
});

test("real PostgreSQL completes a persisted MCP draft receipt after later archival", {
  skip: realDependencySkip,
}, async () => {
  const database = createBackendDatabaseService({ databaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_asset_create_reclaim_${suffix}`;
  const actorId = `it_asset_actor_${suffix}`;
  let now = Date.now();
  const controlled = controlledRuntime();
  const assets = new PostgresCompanyAssetApplication(database.db, controlled.gateway, () => now);
  const baseInput = {
    name: "Reclaimed MCP",
    slug: "reclaimed-mcp",
    endpoint_url: "https://example.com/mcp",
    authentication: "none" as const,
  };
  const recoveredInput = {
    ...baseInput,
    version: "2.0.0",
    idempotency_key: "create-reclaim",
  };
  const mismatchedInput = {
    ...baseInput,
    version: "3.0.0",
    idempotency_key: "create-mismatch",
  };
  try {
    await insertCompany(database.db, companyId, now);
    const initial = await assets.createMcp(companyId, actorId, {
      ...baseInput,
      version: "1.0.0",
      idempotency_key: "create-initial",
    });
    const validated = await assets.validateDraft(companyId, actorId, {
      draft_id: initial.draft.draft_id,
      expected_revision: initial.draft.revision,
      idempotency_key: "validate-initial",
    });
    await assets.publish(companyId, actorId, {
      draft_id: validated.draft.draft_id,
      expected_revision: validated.draft.revision,
      idempotency_key: "publish-initial",
    });

    const created = await assets.createMcp(companyId, actorId, recoveredInput);
    const mismatched = await assets.createMcp(companyId, actorId, mismatchedInput);
    await database.db.update(companyAssetDrafts).set({
      description: "tampered after the original commit",
    }).where(eq(companyAssetDrafts.id, mismatched.draft.draft_id));
    for (const key of [
      recoveredInput.idempotency_key,
      mismatchedInput.idempotency_key,
    ]) {
      await database.db.update(companyAssetMutationReceipts).set({
        status: "pending",
        phase: "runtime_staged",
        result: null,
        leaseOwner: `expired_${key}`,
        leaseExpiresAtMs: now - 1,
        completedAtMs: null,
      }).where(and(
        eq(companyAssetMutationReceipts.companyId, companyId),
        eq(companyAssetMutationReceipts.actorId, actorId),
        eq(companyAssetMutationReceipts.idempotencyKey, key),
      ));
    }

    const beforeArchive = await assets.read(companyId, actorId, created.draft.asset_id);
    const archived = await assets.archive(companyId, actorId, {
      asset_id: created.draft.asset_id,
      expected_revision: beforeArchive.summary.revision,
      idempotency_key: "archive-before-create-reclaim",
    });
    assert.equal(archived.asset.summary.lifecycle, "archived");
    const releaseCallsBeforeRecovery = controlled.releaseDraftCalls;
    const storeCallsBeforeRecovery = controlled.storeMcpCalls;

    const recovered = await assets.createMcp(companyId, actorId, recoveredInput);
    assert.equal(recovered.draft.draft_id, created.draft.draft_id);
    assert.equal(recovered.draft.revision, created.draft.revision);
    assert.equal(controlled.storeMcpCalls, storeCallsBeforeRecovery);
    assert.equal(controlled.releaseDraftCalls, releaseCallsBeforeRecovery);
    const [completedReceipt] = await database.db.select()
      .from(companyAssetMutationReceipts)
      .where(and(
        eq(companyAssetMutationReceipts.companyId, companyId),
        eq(companyAssetMutationReceipts.actorId, actorId),
        eq(
          companyAssetMutationReceipts.idempotencyKey,
          recoveredInput.idempotency_key,
        ),
      ));
    assert.equal(completedReceipt?.status, "completed");

    await assert.rejects(
      assets.createMcp(companyId, actorId, mismatchedInput),
      applicationError("ASSET_PERSISTENCE_INVALID"),
    );
    assert.equal(controlled.storeMcpCalls, storeCallsBeforeRecovery);
    assert.equal(controlled.releaseDraftCalls, releaseCallsBeforeRecovery);

    await assert.rejects(
      assets.createMcp(companyId, actorId, {
        ...baseInput,
        version: "4.0.0",
        idempotency_key: "create-after-archive",
      }),
      applicationError(ASSET_ARCHIVED_CODE),
    );
    assert.equal(controlled.storeMcpCalls, storeCallsBeforeRecovery + 1);
    assert.equal(controlled.releaseDraftCalls, releaseCallsBeforeRecovery + 1);
    const persistedDrafts = await database.db.select()
      .from(companyAssetDrafts)
      .where(eq(companyAssetDrafts.assetId, created.draft.asset_id));
    assert.equal(persistedDrafts.length, 2);
    assert.equal(
      (await assets.read(companyId, actorId, created.draft.asset_id)).summary.lifecycle,
      "archived",
    );
  } finally {
    await deleteCompany(database.db, companyId);
    await database.close();
  }
});

test("real PostgreSQL reclaims publish after the version commit and a retryable draft release", {
  skip: realDependencySkip,
}, async () => {
  const database = createBackendDatabaseService({ databaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_asset_publish_reclaim_${suffix}`;
  const actorId = `it_asset_actor_${suffix}`;
  let now = Date.now();
  const controlled = controlledRuntime({ releaseDraftFailures: 1 });
  const assets = new PostgresCompanyAssetApplication(database.db, controlled.gateway, () => now);
  const publishInput = {
    draft_id: "",
    expected_revision: 1,
    idempotency_key: "publish-reclaim",
  };
  try {
    await insertCompany(database.db, companyId, now);
    const draft = await createValidatedSkill(
      assets,
      companyId,
      actorId,
      "publish-reclaim",
      "reclaim-skill",
      "1.0.0",
    );
    publishInput.draft_id = draft.draft_id;
    publishInput.expected_revision = draft.revision;

    await assert.rejects(
      assets.publish(companyId, actorId, publishInput),
      retryableRuntimeFailure,
    );
    const [pendingReceipt] = await database.db.select()
      .from(companyAssetMutationReceipts)
      .where(and(
        eq(companyAssetMutationReceipts.companyId, companyId),
        eq(companyAssetMutationReceipts.idempotencyKey, publishInput.idempotency_key),
      ));
    assert.equal(pendingReceipt?.status, "pending");
    assert.equal(pendingReceipt?.phase, "database_committed");

    now += 5 * 60_000 + 1;
    const recovered = await assets.publish(companyId, actorId, publishInput);
    const versions = await database.db.select()
      .from(companyAssetVersions)
      .where(eq(companyAssetVersions.companyId, companyId));
    const [completedReceipt] = await database.db.select()
      .from(companyAssetMutationReceipts)
      .where(and(
        eq(companyAssetMutationReceipts.companyId, companyId),
        eq(companyAssetMutationReceipts.idempotencyKey, publishInput.idempotency_key),
      ));
    assert.equal(versions.length, 1);
    assert.equal(recovered.asset.versions.length, 1);
    assert.equal(recovered.asset.current?.version_id, versions[0]?.id);
    assert.equal(recovered.published_version.version_id, versions[0]?.id);
    assert.equal(controlled.releaseDraftCalls, 2);
    assert.equal(completedReceipt?.status, "completed");
    assert.equal(completedReceipt?.phase, "completed");
    assert.ok(completedReceipt?.completedAtMs);
  } finally {
    await deleteCompany(database.db, companyId);
    await database.close();
  }
});

test("real PostgreSQL reclaims credential commit without repeating its revision or persisting a token", {
  skip: realDependencySkip,
}, async () => {
  const database = createBackendDatabaseService({ databaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_asset_credential_reclaim_${suffix}`;
  const actorId = `it_asset_actor_${suffix}`;
  const initialSecret = `initial-runtime-only-secret-${suffix}`;
  const secret = `credential-secret-${suffix}`;
  let now = Date.now();
  const controlled = controlledRuntime({ credentialCommitFailures: 1 });
  const assets = new PostgresCompanyAssetApplication(database.db, controlled.gateway, () => now);
  try {
    await insertCompany(database.db, companyId, now);
    const created = await assets.createMcp(companyId, actorId, {
      name: "Credential MCP",
      slug: "credential-mcp",
      version: "1.0.0",
      endpoint_url: "https://example.com/mcp",
      authentication: "bearer",
      bearer_token: initialSecret,
      idempotency_key: "credential-create",
    });
    const input = {
      asset_id: created.draft.asset_id,
      target: {
        type: "draft" as const,
        draft_id: created.draft.draft_id,
        expected_revision: created.draft.revision,
      },
      bearer_token: secret,
      idempotency_key: "credential-reclaim",
    };

    await assert.rejects(
      assets.replaceCredential(companyId, actorId, input),
      retryableRuntimeFailure,
    );
    const [committedDraft] = await database.db.select()
      .from(companyAssetDrafts)
      .where(eq(companyAssetDrafts.id, created.draft.draft_id));
    const [pendingReceipt] = await database.db.select()
      .from(companyAssetMutationReceipts)
      .where(and(
        eq(companyAssetMutationReceipts.companyId, companyId),
        eq(companyAssetMutationReceipts.idempotencyKey, input.idempotency_key),
      ));
    assert.equal(committedDraft?.revision, created.draft.revision + 1);
    assert.equal(pendingReceipt?.status, "pending");
    assert.equal(pendingReceipt?.phase, "database_committed");

    now += 5 * 60_000 + 1;
    const recovered = await assets.replaceCredential(companyId, actorId, input);
    const [recoveredDraft] = await database.db.select()
      .from(companyAssetDrafts)
      .where(eq(companyAssetDrafts.id, created.draft.draft_id));
    const [completedReceipt] = await database.db.select()
      .from(companyAssetMutationReceipts)
      .where(and(
        eq(companyAssetMutationReceipts.companyId, companyId),
        eq(companyAssetMutationReceipts.idempotencyKey, input.idempotency_key),
      ));
    assert.equal(recoveredDraft?.revision, created.draft.revision + 1);
    assert.equal(recovered.asset.drafts[0]?.revision, created.draft.revision + 1);
    assert.equal(controlled.credentialStageCalls.length, 1);
    assert.equal(controlled.credentialStageCalls[0]?.target_revision, created.draft.revision + 1);
    assert.equal(controlled.credentialCommitCalls, 2);
    await assert.rejects(
      assets.replaceCredential(companyId, actorId, {
        ...input,
        bearer_token: `${secret}-different`,
      }),
      (error: unknown) => (
        error instanceof ApplicationError
        && error.code === "ASSET_IDEMPOTENCY_CONFLICT"
      ),
    );
    assert.equal(completedReceipt?.status, "completed");
    assert.equal(completedReceipt?.phase, "completed");
    const persisted = JSON.stringify({
      draft: recoveredDraft,
      receipt: completedReceipt,
    });
    for (const runtimeOnlySecret of [initialSecret, secret]) {
      assert.doesNotMatch(persisted, new RegExp(runtimeOnlySecret, "u"));
    }
    assert.doesNotMatch(persisted, /bearer_token/u);
  } finally {
    await deleteCompany(database.db, companyId);
    await database.close();
  }
});

test("published MCP credential replacement keeps the version row immutable", {
  skip: realDependencySkip,
}, async () => {
  const database = createBackendDatabaseService({ databaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_asset_version_credential_${suffix}`;
  const actorId = `it_asset_actor_${suffix}`;
  let now = Date.now();
  const controlled = controlledRuntime();
  const assets = new PostgresCompanyAssetApplication(database.db, controlled.gateway, () => ++now);
  try {
    await insertCompany(database.db, companyId, now);
    const created = await assets.createMcp(companyId, actorId, {
      name: "Published Credential MCP",
      slug: "published-credential-mcp",
      version: "1.0.0",
      endpoint_url: "https://example.com/mcp",
      authentication: "bearer",
      bearer_token: `runtime-only-${suffix}`,
      idempotency_key: "published-credential-create",
    });
    const validated = await assets.validateDraft(companyId, actorId, {
      draft_id: created.draft.draft_id,
      expected_revision: created.draft.revision,
      idempotency_key: "published-credential-validate",
    });
    const published = await assets.publish(companyId, actorId, {
      draft_id: validated.draft.draft_id,
      expected_revision: validated.draft.revision,
      idempotency_key: "published-credential-publish",
    });
    const versionId = published.published_version.version_id;
    const [immutableBefore] = await database.db.select()
      .from(companyAssetVersions)
      .where(eq(companyAssetVersions.id, versionId));

    assert.deepEqual(await assets.listMcpTools(companyId, actorId, {
      asset_id: published.asset.summary.asset_id,
    }), {
      asset_id: published.asset.summary.asset_id,
      version_id: versionId,
      tools: [],
    });
    assert.deepEqual(await assets.callMcpTool(companyId, actorId, {
      asset_id: published.asset.summary.asset_id,
      expected_version_id: versionId,
      tool_name: "get_issue",
      arguments: { owner: "octo", repo: "repo", issue_number: 42 },
    }), {
      asset_id: published.asset.summary.asset_id,
      version_id: versionId,
      tool_name: "get_issue",
      is_error: false,
      text: [],
      structured_content: null,
    });
    await assert.rejects(assets.callMcpTool(companyId, actorId, {
      asset_id: published.asset.summary.asset_id,
      expected_version_id: "asset_version_stale",
      tool_name: "get_issue",
      arguments: {},
    }), applicationError(ASSET_VERSION_CONFLICT_CODE));

    const replaced = await assets.replaceCredential(companyId, actorId, {
      asset_id: published.asset.summary.asset_id,
      target: {
        type: "version",
        version_id: versionId,
        expected_revision: published.published_version.revision,
      },
      bearer_token: null,
      idempotency_key: "published-credential-replace",
    });

    const [immutableAfter] = await database.db.select()
      .from(companyAssetVersions)
      .where(eq(companyAssetVersions.id, versionId));
    const [credentialProjection] = await database.db.select()
      .from(companyAssetVersionCredentials)
      .where(eq(companyAssetVersionCredentials.versionId, versionId));
    assert.deepEqual(immutableAfter, immutableBefore);
    assert.equal(credentialProjection?.revision, 2);
    assert.equal(credentialProjection?.credentialConfigured, false);
    assert.equal(replaced.asset.current?.revision, 2);
    assert.equal(replaced.asset.current?.source.type, "mcp");
    assert.equal(replaced.asset.current?.source.type === "mcp"
      ? replaced.asset.current.source.credential_configured
      : null, false);
    await assert.rejects(assets.listMcpTools(companyId, actorId, {
      asset_id: published.asset.summary.asset_id,
    }), applicationError(ASSET_MCP_CREDENTIAL_REQUIRED_CODE));
  } finally {
    await deleteCompany(database.db, companyId);
    await database.close();
  }
});

test("real PostgreSQL rejects stale draft revisions and non-increasing Skill versions", {
  skip: realDependencySkip,
}, async () => {
  const database = createBackendDatabaseService({ databaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_asset_revision_semver_${suffix}`;
  const actorId = `it_asset_actor_${suffix}`;
  let now = Date.now();
  const controlled = controlledRuntime();
  const assets = new PostgresCompanyAssetApplication(database.db, controlled.gateway, () => ++now);
  try {
    await insertCompany(database.db, companyId, now);
    const firstDraft = await createValidatedSkill(
      assets,
      companyId,
      actorId,
      "semver-first",
      "semver-skill",
      "2.0.0",
    );
    const firstPublished = await assets.publish(companyId, actorId, {
      draft_id: firstDraft.draft_id,
      expected_revision: firstDraft.revision,
      idempotency_key: "semver-first-publish",
    });
    const equalDraft = await createValidatedSkill(
      assets,
      companyId,
      actorId,
      "semver-equal",
      "semver-skill",
      "2.0.0",
    );
    assert.equal(equalDraft.asset_id, firstPublished.asset.summary.asset_id);

    await assert.rejects(
      assets.updateDraft(companyId, actorId, {
        draft_id: equalDraft.draft_id,
        expected_revision: equalDraft.revision - 1,
        description: "stale write",
        idempotency_key: "semver-stale-revision",
      }),
      applicationError(ASSET_REVISION_CONFLICT_CODE),
    );
    await assert.rejects(
      assets.publish(companyId, actorId, {
        draft_id: equalDraft.draft_id,
        expected_revision: equalDraft.revision,
        idempotency_key: "semver-equal-publish",
      }),
      applicationError(ASSET_VERSION_CONFLICT_CODE),
    );

    const lowered = await assets.updateDraft(companyId, actorId, {
      draft_id: equalDraft.draft_id,
      expected_revision: equalDraft.revision,
      version: "1.9.0",
      idempotency_key: "semver-lower-update",
    });
    const lowerValidated = await assets.validateDraft(companyId, actorId, {
      draft_id: lowered.draft.draft_id,
      expected_revision: lowered.draft.revision,
      idempotency_key: "semver-lower-validate",
    });
    await assert.rejects(
      assets.publish(companyId, actorId, {
        draft_id: lowerValidated.draft.draft_id,
        expected_revision: lowerValidated.draft.revision,
        idempotency_key: "semver-lower-publish",
      }),
      applicationError(ASSET_VERSION_CONFLICT_CODE),
    );
    const versions = await database.db.select()
      .from(companyAssetVersions)
      .where(eq(companyAssetVersions.assetId, firstPublished.asset.summary.asset_id));
    assert.deepEqual(versions.map((version) => version.version), ["2.0.0"]);
  } finally {
    await deleteCompany(database.db, companyId);
    await database.close();
  }
});

async function* body(bytes: Buffer): AsyncGenerator<Buffer> {
  yield bytes;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

type BackendDatabase = ReturnType<typeof createBackendDatabaseService>["db"];
type CredentialStageInput = Parameters<
  CompanyAssetRuntimeGateway["assetCredentialStage"]
>[1];

function controlledRuntime(options: {
  releaseDraftFailures?: number;
  credentialCommitFailures?: number;
} = {}): {
  gateway: CompanyAssetRuntimeGateway;
  get releaseDraftCalls(): number;
  get storeMcpCalls(): number;
  get credentialCommitCalls(): number;
  credentialStageCalls: CredentialStageInput[];
} {
  const digest = "b".repeat(64);
  let releaseDraftCalls = 0;
  let storeMcpCalls = 0;
  let credentialCommitCalls = 0;
  const credentialStageCalls: CredentialStageInput[] = [];
  const validation = {
    status: "valid" as const,
    validated_at_ms: 1,
    validator: "integration",
    issues: [],
    capabilities: { entries: [], credential_configured: false },
  };
  const gateway: CompanyAssetRuntimeGateway = {
    assetImportZip: async (_companyId, input) => ({
      content_sha256: digest,
      source: { type: "zip" as const, file_name: input.file_name },
      inferred_name: null,
      inferred_slug: null,
      inferred_version: input.kind === "plugin" ? "1.0.0" : null,
      files: [{
        path: input.kind === "plugin" ? ".codex-plugin/plugin.json" : "SKILL.md",
        type: "file" as const,
        size_bytes: 1,
        sha256: digest,
      }],
    }),
    assetImportGit: async () => { throw new Error("not used"); },
    assetImportWorkspaceZip: async () => { throw new Error("not used"); },
    assetStoreMcp: async (_companyId, input) => {
      storeMcpCalls += 1;
      return {
        content_sha256: digest,
        source: {
          type: "mcp" as const,
          endpoint_url: input.endpoint_url,
          authentication: input.authentication,
          credential_configured: input.bearer_token !== undefined && input.bearer_token !== null,
        },
        inferred_name: null,
        inferred_slug: null,
        inferred_version: null,
        files: [{
          path: "mcp.json",
          type: "file" as const,
          size_bytes: 1,
          sha256: digest,
        }],
      };
    },
    assetValidate: async () => ({ validation, capabilities: validation.capabilities }),
    assetContentRead: async () => { throw new Error("not used"); },
    assetPublishReference: async () => undefined,
    assetReleaseDraft: async () => {
      releaseDraftCalls += 1;
      if (releaseDraftCalls <= (options.releaseDraftFailures ?? 0)) {
        throw new ApplicationError("ASSET_RUNTIME_RETRY", true);
      }
    },
    assetDraftReferenceCas: async () => undefined,
    assetReleaseVersion: async () => undefined,
    assetCredentialStage: async (_companyId, input) => {
      credentialStageCalls.push(input);
    },
    assetCredentialCommit: async () => {
      credentialCommitCalls += 1;
      if (credentialCommitCalls <= (options.credentialCommitFailures ?? 0)) {
        throw new ApplicationError("ASSET_RUNTIME_RETRY", true);
      }
    },
    assetCredentialAbort: async () => undefined,
    assetMcpToolsList: async () => ({ tools: [] }),
    assetMcpToolCall: async (_companyId, input) => ({
      tool_name: input.tool_name,
      is_error: false,
      text: [],
      structured_content: null,
    }),
  };
  return {
    gateway,
    get releaseDraftCalls() {
      return releaseDraftCalls;
    },
    get storeMcpCalls() {
      return storeMcpCalls;
    },
    get credentialCommitCalls() {
      return credentialCommitCalls;
    },
    credentialStageCalls,
  };
}

async function createValidatedSkill(
  assets: PostgresCompanyAssetApplication,
  companyId: string,
  actorId: string,
  keyPrefix: string,
  slug: string,
  version: string,
) {
  const started = await assets.beginZip(companyId, actorId, {
    kind: "skill",
    name: "Integration Skill",
    slug,
    version,
    file_name: `${slug}.zip`,
    idempotency_key: `${keyPrefix}-begin`,
  });
  const packageBytes = Buffer.from(`${slug}:${version}`);
  const uploaded = await assets.uploadPackage(companyId, actorId, {
    draft_id: started.draft.draft_id,
    expected_revision: started.draft.revision,
    idempotency_key: `${keyPrefix}-upload`,
    package_sha256: createHash("sha256").update(packageBytes).digest("hex"),
    package_size_bytes: packageBytes.byteLength,
    package_body: body(packageBytes),
  });
  return (await assets.validateDraft(companyId, actorId, {
    draft_id: uploaded.draft.draft_id,
    expected_revision: uploaded.draft.revision,
    idempotency_key: `${keyPrefix}-validate`,
  })).draft;
}

async function insertCompany(
  database: BackendDatabase,
  companyId: string,
  now: number,
): Promise<void> {
  await database.insert(companies).values({
    id: companyId,
    name: "Asset integration",
    status: "active",
    createdAtMs: now,
    updatedAtMs: now,
  });
}

async function deleteCompany(database: BackendDatabase, companyId: string): Promise<void> {
  await database.delete(companies).where(eq(companies.id, companyId)).catch(() => undefined);
}

function retryableRuntimeFailure(error: unknown): boolean {
  return (
    error instanceof ApplicationError
    && error.code === "ASSET_RUNTIME_RETRY"
    && error.retryable
  );
}

function applicationError(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ApplicationError && error.code === code;
}
