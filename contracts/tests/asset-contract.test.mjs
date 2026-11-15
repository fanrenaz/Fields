import assert from "node:assert/strict";
import test from "node:test";

import {
  assetDetailSchema,
  assetDraftBeginZipInputSchema,
  assetDraftCreateMcpInputSchema,
  assetDraftImportGitInputSchema,
  assetDraftUpdateInputSchema,
  assetListInputSchema,
  assetMcpCredentialReplaceInputSchema,
  assetSourceSchema,
  assetVersionRecordSchema,
  assetVersionSchema,
} from "../dist/public/asset.js";
import { searchAssetItemSchema } from "../dist/public/search.js";
import { backendRouter } from "../dist/router/backend.js";
import {
  runtimeAgentAssetImportWorkspaceZipInputSchema,
  runtimeAssetGitImportInputSchema,
  runtimeAssetMcpStoreInputSchema,
} from "../dist/internal/asset.js";

const validIdentity = { name: "Research helper", slug: "research-helper" };

test("asset contracts cover all kinds, lifecycle filters, and exact Backend procedures", () => {
  for (const kind of ["plugin", "skill", "mcp"]) {
    assert.equal(assetListInputSchema.parse({ kind }).kind, kind);
  }
  for (const lifecycle of ["draft", "published", "archived"]) {
    assert.equal(assetListInputSchema.parse({ lifecycle }).lifecycle, lifecycle);
  }
  const procedures = backendRouter._def.procedures;
  for (const procedure of [
    "assets.list",
    "assets.read",
    "assets.content.read",
    "assets.draft.beginZip",
    "assets.draft.importGit",
    "assets.draft.createMcp",
    "assets.draft.update",
    "assets.draft.validate",
    "assets.draft.delete",
    "assets.publish",
    "assets.archive",
    "assets.restore",
    "assets.mcp.credential.replace",
    "company.members.assets.applyInstallation",
  ]) {
    assert.ok(procedures[procedure], procedure);
  }
  assert.equal(procedures["company.members.assets.apply"], undefined);
});

test("MCP credentials are accepted only on mutation inputs and never projected", () => {
  assert.equal(assetDraftCreateMcpInputSchema.safeParse({
    ...validIdentity,
    version: "1.0.0",
    endpoint_url: "https://example.com/mcp",
    authentication: "bearer",
    idempotency_key: "key",
  }).success, false);
  assert.equal(assetDraftCreateMcpInputSchema.safeParse({
    ...validIdentity,
    version: "1.0.0",
    endpoint_url: "https://example.com/mcp",
    authentication: "bearer",
    bearer_token: "secret",
    idempotency_key: "key",
  }).success, true);
  assert.equal(assetMcpCredentialReplaceInputSchema.parse({
    asset_id: "asset",
    target: {
      type: "draft",
      draft_id: "draft",
      expected_revision: 1,
    },
    bearer_token: null,
    idempotency_key: "key",
  }).bearer_token, null);
  assert.equal(runtimeAssetMcpStoreInputSchema.parse({
    operation_id: "operation",
    request_fingerprint: "a".repeat(64),
    draft_id: "draft",
    expected_content_sha256: null,
    endpoint_url: "https://example.com/mcp",
    authentication: "bearer",
  }).bearer_token, undefined);
  assert.equal(
    JSON.stringify(assetDetailSchema._def).includes("bearer_token"),
    false,
  );
});

test("Git repository URL policy is identical in public inputs, source projections, and Runtime", () => {
  const publicInput = {
    kind: "skill",
    version: "1.0.0",
    repository_url: "https://example.com/repository",
    idempotency_key: "operation",
  };
  assert.equal(assetDraftImportGitInputSchema.safeParse(publicInput).success, true);
  assert.equal(runtimeAssetGitImportInputSchema.safeParse({
    operation_id: "operation",
    request_fingerprint: "b".repeat(64),
    draft_id: "draft",
    expected_content_sha256: null,
    kind: "skill",
    repository_url: publicInput.repository_url,
    subdirectory: null,
  }).success, true);

  for (const repository_url of [
    "http://example.com/repository",
    "https://user:password@example.com/repository",
    "https://example.com/repository?token=secret",
    "https://example.com/repository#secret",
    `https://example.com/${"a".repeat(2_048)}`,
  ]) {
    assert.equal(assetDraftImportGitInputSchema.safeParse({
      ...publicInput,
      repository_url,
    }).success, false, repository_url);
    assert.equal(runtimeAssetGitImportInputSchema.safeParse({
      operation_id: "operation",
      request_fingerprint: "b".repeat(64),
      draft_id: "draft",
      expected_content_sha256: null,
      kind: "skill",
      repository_url,
      subdirectory: null,
    }).success, false, repository_url);
  }
  assert.equal(assetDraftImportGitInputSchema.safeParse({
    ...publicInput,
    repository_url: "https://example.com:8443/repository",
  }).success, true);
});

test("asset source projections remain a strict discriminated union", () => {
  assert.equal(assetSourceSchema.safeParse({
    type: "zip",
    file_name: "skill.zip",
  }).success, true);
  assert.equal(assetSourceSchema.safeParse({
    type: "git",
    repository_url: "https://example.com/repository",
    commit_sha: "a".repeat(40),
    subdirectory: null,
  }).success, true);
  assert.equal(assetSourceSchema.safeParse({
    type: "mcp",
    endpoint_url: "https://example.com/mcp",
    authentication: "bearer",
    credential_configured: true,
  }).success, true);
  assert.equal(assetSourceSchema.safeParse({
    type: "zip",
    file_name: "skill.zip",
    bearer_token: "must-not-project",
  }).success, false);
});

test("asset SemVer accepts only safe MAJOR.MINOR.PATCH versions", () => {
  assert.equal(assetVersionSchema.safeParse("0.0.0").success, true);
  assert.equal(assetVersionSchema.safeParse("123.456.789").success, true);
  for (const version of [
    "01.0.0",
    "1.0.0-alpha",
    "1.0.0+build",
    "9007199254740992.0.0",
  ]) {
    assert.equal(assetVersionSchema.safeParse(version).success, false, version);
  }
});

test("published asset versions carry a strict immutable file-tree snapshot", () => {
  const version = {
    version_id: "version-one",
    revision: 1,
    version: "1.0.0",
    source: { type: "zip", file_name: "skill.zip" },
    content_sha256: "a".repeat(64),
    files: [{
      path: "SKILL.md",
      type: "file",
      size_bytes: 10,
      sha256: "b".repeat(64),
    }],
    validation: {
      status: "valid",
      validated_at_ms: 1,
      validator: "test",
      issues: [],
      capabilities: { entries: [], credential_configured: false },
    },
    published_by_actor_id: "actor-one",
    published_at_ms: 2,
  };
  assert.deepEqual(assetVersionRecordSchema.parse(version), version);
  const { files: _files, ...missingFiles } = version;
  assert.equal(assetVersionRecordSchema.safeParse(missingFiles).success, false);
  assert.equal(assetVersionRecordSchema.safeParse({
    ...version,
    mutable: true,
  }).success, false);
});

test("global search uses the public asset projection without system or credential fields", () => {
  assert.deepEqual(searchAssetItemSchema.parse({
    kind: "asset",
    asset_id: "asset-one",
    asset_kind: "skill",
    name: "Research helper",
    slug: "research-helper",
    description: "Searchable published asset",
    current_version: "1.2.3",
    updated_at_ms: 1,
  }), {
    kind: "asset",
    asset_id: "asset-one",
    asset_kind: "skill",
    name: "Research helper",
    slug: "research-helper",
    description: "Searchable published asset",
    current_version: "1.2.3",
    updated_at_ms: 1,
  });
  assert.equal(JSON.stringify(assetDetailSchema._def).includes("fields-core"), false);
  assert.equal(JSON.stringify(searchAssetItemSchema._def).includes("credential"), false);
});

test("MCP endpoint limits are identical in public and Runtime mutation inputs", () => {
  const overlongEndpoint = `https://example.com/${"a".repeat(2_048)}`;
  assert.equal(assetDraftCreateMcpInputSchema.safeParse({
    ...validIdentity,
    version: "1.0.0",
    endpoint_url: overlongEndpoint,
    authentication: "none",
    idempotency_key: "public-overlong",
  }).success, false);
  assert.equal(runtimeAssetMcpStoreInputSchema.safeParse({
    operation_id: "runtime-overlong",
    request_fingerprint: "c".repeat(64),
    draft_id: "draft",
    expected_content_sha256: null,
    endpoint_url: overlongEndpoint,
    authentication: "none",
  }).success, false);
});

test("draft creation and update contracts enforce kind-specific version semantics", () => {
  const commonZip = {
    name: "Research helper",
    slug: "research-helper",
    file_name: "asset.zip",
    idempotency_key: "zip",
  };
  assert.equal(assetDraftBeginZipInputSchema.safeParse({
    ...commonZip,
    kind: "plugin",
    version: null,
  }).success, true);
  assert.equal(assetDraftBeginZipInputSchema.safeParse({
    ...commonZip,
    kind: "plugin",
    version: "1.0.0",
  }).success, false);
  assert.equal(assetDraftBeginZipInputSchema.safeParse({
    ...commonZip,
    kind: "skill",
  }).success, false);
  assert.equal(assetDraftBeginZipInputSchema.safeParse({
    ...commonZip,
    kind: "skill",
    version: "1.0.0",
  }).success, true);
  assert.equal(assetDraftImportGitInputSchema.safeParse({
    kind: "skill",
    repository_url: "https://example.com/repository",
    idempotency_key: "git-skill",
  }).success, false);
  assert.equal(assetDraftImportGitInputSchema.safeParse({
    kind: "plugin",
    repository_url: "https://example.com/repository",
    version: "1.0.0",
    idempotency_key: "git-plugin",
  }).success, false);
  assert.equal(assetDraftUpdateInputSchema.safeParse({
    draft_id: "draft",
    expected_revision: 1,
    idempotency_key: "empty-update",
  }).success, false);
  const workspaceInput = {
    thread_id: "thread",
    name: "Research helper",
    slug: "research-helper",
    workspace_relative_path: "asset.zip",
    idempotency_key: "workspace",
  };
  const agent = {
    identity: {
      company_id: "company",
    },
    member_id: "member",
  };
  assert.equal(runtimeAgentAssetImportWorkspaceZipInputSchema.safeParse({
    ...agent,
    input: { ...workspaceInput, kind: "plugin", version: "1.0.0" },
  }).success, false);
  assert.equal(runtimeAgentAssetImportWorkspaceZipInputSchema.safeParse({
    ...agent,
    input: { ...workspaceInput, kind: "skill" },
  }).success, false);
  assert.equal(runtimeAgentAssetImportWorkspaceZipInputSchema.safeParse({
    ...agent,
    input: { ...workspaceInput, kind: "skill", version: "1.0.0" },
  }).success, true);
});
