import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedAssetImportModes,
  appendUniqueAssetItems,
  assetLifecycleIsReadOnly,
  assetMutationFingerprint,
  assetValidationIssueMessageKey,
  beginAssetPreview,
  draftDeletionRemovesAsset,
  formatAssetBytes,
  GITHUB_MCP_PRESET,
  githubFineGrainedPatUrl,
  isOfficialGitHubMcpSource,
  reconcileAssetSelection,
  resolveDraftSelection,
  resolveVersionSelection,
  reuseOrCreateAssetMutationAttempt,
  reuseOrCreateZipUploadAttempt,
  settleAssetPreview,
  zipAttemptFingerprint,
} from "../../../../features/assets/asset-workbench-state";

test("GitHub setup uses the official MCP endpoint and least-scope PAT template", () => {
  const url = new URL(githubFineGrainedPatUrl());
  assert.equal(url.origin + url.pathname, "https://github.com/settings/personal-access-tokens/new");
  assert.equal(url.searchParams.get("name"), "Fields GitHub MCP");
  assert.equal(url.searchParams.get("expires_in"), "90");
  assert.equal(url.searchParams.get("contents"), "write");
  assert.equal(url.searchParams.get("issues"), "write");
  assert.equal(url.searchParams.get("pull_requests"), "write");
  assert.equal(url.searchParams.get("metadata"), "read");
  assert.equal(url.searchParams.has("workflows"), false);
  assert.equal(GITHUB_MCP_PRESET.endpointUrl, "https://api.githubcopilot.com/mcp/");
  assert.equal(isOfficialGitHubMcpSource({
    type: "mcp",
    endpoint_url: GITHUB_MCP_PRESET.endpointUrl,
    authentication: "bearer",
  }), true);
  assert.equal(isOfficialGitHubMcpSource({
    type: "mcp",
    endpoint_url: "https://example.com/mcp",
    authentication: "bearer",
  }), false);
});

test("pagination appends unseen assets once and preserves order", () => {
  assert.deepEqual(
    appendUniqueAssetItems(
      [{ asset_id: "a" }, { asset_id: "b" }],
      [{ asset_id: "b" }, { asset_id: "c" }, { asset_id: "c" }],
    ),
    [{ asset_id: "a" }, { asset_id: "b" }, { asset_id: "c" }],
  );
});

test("deep links survive the initial page but yield after the filter scope changes", () => {
  assert.equal(reconcileAssetSelection({
    currentId: "deep-linked",
    initialTargetId: "deep-linked",
    initialTargetScopeActive: true,
    items: [{ asset_id: "first-page" }],
  }), "deep-linked");

  assert.equal(reconcileAssetSelection({
    currentId: "deep-linked",
    initialTargetId: "deep-linked",
    initialTargetScopeActive: false,
    items: [{ asset_id: "filtered-first" }],
  }), "filtered-first");

  assert.equal(reconcileAssetSelection({
    currentId: "visible",
    initialTargetId: "deep-linked",
    initialTargetScopeActive: false,
    items: [{ asset_id: "visible" }],
  }), "visible");
});

test("draft selection stays stable across refreshes and falls back when removed", () => {
  const drafts = [{ draft_id: "newest" }, { draft_id: "selected" }];
  assert.equal(resolveDraftSelection(drafts, "selected")?.draft_id, "selected");
  assert.equal(resolveDraftSelection(drafts, "removed")?.draft_id, "newest");
  assert.equal(resolveDraftSelection([], "removed"), null);
});

test("version selection stays stable and falls back to the current immutable snapshot", () => {
  const versions = [{ version_id: "old" }, { version_id: "current" }];
  assert.equal(
    resolveVersionSelection(versions, "current", "old")?.version_id,
    "old",
  );
  assert.equal(
    resolveVersionSelection(versions, "current", "removed")?.version_id,
    "current",
  );
  assert.equal(resolveVersionSelection([], "current", "removed"), null);
});

test("published version import modes cannot change the asset kind", () => {
  assert.deepEqual(allowedAssetImportModes("plugin"), ["zip", "git"]);
  assert.deepEqual(allowedAssetImportModes("skill"), ["zip", "git"]);
  assert.deepEqual(allowedAssetImportModes("mcp"), ["mcp"]);
  assert.deepEqual(allowedAssetImportModes(null), ["zip", "git", "mcp"]);
});

test("archived assets are read-only while active lifecycle states remain writable", () => {
  assert.equal(assetLifecycleIsReadOnly("archived"), true);
  assert.equal(assetLifecycleIsReadOnly("draft"), false);
  assert.equal(assetLifecycleIsReadOnly("published"), false);
});

test("Runtime validation codes map to stable localized UI messages", () => {
  assert.equal(
    assetValidationIssueMessageKey("asset_plugin_manifest_invalid"),
    "assets.validationIssues.pluginManifestInvalid",
  );
  assert.equal(
    assetValidationIssueMessageKey("asset_skill_codex_validation_failed"),
    "assets.validationIssues.skillRejected",
  );
  assert.equal(
    assetValidationIssueMessageKey("asset_private_network_forbidden"),
    "assets.validationIssues.endpointInvalid",
  );
  assert.equal(
    assetValidationIssueMessageKey("asset_mcp_timeout"),
    "assets.validationIssues.endpointUnavailable",
  );
  assert.equal(
    assetValidationIssueMessageKey("asset_mcp_secret_reflection"),
    "assets.validationIssues.secretReflection",
  );
  assert.equal(
    assetValidationIssueMessageKey("asset_validation_response_invalid"),
    "assets.validationIssues.generic",
  );
  assert.equal(
    assetValidationIssueMessageKey("unrecognized_runtime_code"),
    "assets.validationIssues.generic",
  );
});

test("deleting the final unpublished draft removes its asset selection", () => {
  assert.equal(draftDeletionRemovesAsset({
    hasCurrentVersion: false,
    draftCount: 1,
  }), true);
  assert.equal(draftDeletionRemovesAsset({
    hasCurrentVersion: false,
    draftCount: 2,
  }), false);
  assert.equal(draftDeletionRemovesAsset({
    hasCurrentVersion: true,
    draftCount: 1,
  }), false);
});

test("ZIP retries reuse begun draft and stable idempotency keys", () => {
  const input = {
    kind: "skill" as const,
    name: "Research helper",
    slug: "research-helper",
    version: "1.2.3",
    description: "Research",
    file: { name: "skill.zip", size: 128, lastModified: 42 },
  };
  const fingerprint = zipAttemptFingerprint(input);
  let nextKey = 0;
  const createKey = () => `key-${++nextKey}`;
  const first = reuseOrCreateZipUploadAttempt(null, fingerprint, createKey);
  const begun = { ...first, begunDraft: { draft_id: "draft-1", revision: 1 } };
  const retry = reuseOrCreateZipUploadAttempt(begun, fingerprint, createKey);

  assert.strictEqual(retry, begun);
  assert.equal(retry.beginIdempotencyKey, "key-1");
  assert.equal(retry.uploadIdempotencyKey, "key-2");
  assert.equal(retry.begunDraft?.draft_id, "draft-1");
  assert.equal(nextKey, 2);

  const changed = reuseOrCreateZipUploadAttempt(
    retry,
    zipAttemptFingerprint({
      ...input,
      file: { ...input.file, lastModified: 43 },
    }),
    createKey,
  );
  assert.equal(changed.begunDraft, null);
  assert.equal(changed.beginIdempotencyKey, "key-3");
  assert.equal(changed.uploadIdempotencyKey, "key-4");
});

test("response-lost retries reuse one Human mutation operation", () => {
  const fingerprint = assetMutationFingerprint("draft.update", {
    draft_id: "draft-1",
    expected_revision: 3,
    name: "Research helper",
    description: "Updated",
  });
  let nextKey = 0;
  const createKey = () => `mutation-key-${++nextKey}`;
  const submitted = reuseOrCreateAssetMutationAttempt(null, fingerprint, createKey);
  const responseLostRetry = reuseOrCreateAssetMutationAttempt(
    submitted,
    assetMutationFingerprint("draft.update", {
      description: "Updated",
      name: "Research helper",
      expected_revision: 3,
      draft_id: "draft-1",
    }),
    createKey,
  );

  assert.strictEqual(responseLostRetry, submitted);
  assert.equal(responseLostRetry.idempotencyKey, "mutation-key-1");
  assert.equal(nextKey, 1);
});

test("Human mutation attempts rotate keys when operation, target, revision, or form semantics change", () => {
  let nextKey = 0;
  const createKey = () => `mutation-key-${++nextKey}`;
  let attempt = reuseOrCreateAssetMutationAttempt(
    null,
    assetMutationFingerprint("draft.validate", {
      draft_id: "draft-1",
      expected_revision: 3,
    }),
    createKey,
  );
  for (const fingerprint of [
    assetMutationFingerprint("draft.publish", {
      draft_id: "draft-1",
      expected_revision: 3,
    }),
    assetMutationFingerprint("draft.publish", {
      draft_id: "draft-2",
      expected_revision: 3,
    }),
    assetMutationFingerprint("draft.publish", {
      draft_id: "draft-2",
      expected_revision: 4,
    }),
    assetMutationFingerprint("draft.update", {
      draft_id: "draft-2",
      expected_revision: 4,
      name: "Changed",
    }),
  ]) {
    const changed = reuseOrCreateAssetMutationAttempt(attempt, fingerprint, createKey);
    assert.notEqual(changed.idempotencyKey, attempt.idempotencyKey);
    attempt = changed;
  }
  assert.equal(nextKey, 5);
});

test("stale preview completion cannot replace the active file", () => {
  const first = beginAssetPreview<{ path: string }>(1, "first.md");
  const second = beginAssetPreview<{ path: string }>(2, "second.md");
  const stale = settleAssetPreview(second, first.requestId, {
    ok: true,
    content: { path: "first.md" },
  });
  assert.strictEqual(stale, second);

  const ready = settleAssetPreview(second, second.requestId, {
    ok: true,
    content: { path: "second.md" },
  });
  assert.deepEqual(ready, {
    status: "ready",
    requestId: 2,
    content: { path: "second.md" },
  });

  assert.deepEqual(settleAssetPreview(beginAssetPreview(3, "failed.md"), 3, {
    ok: false,
    path: "failed.md",
  }), {
    status: "error",
    requestId: 3,
    path: "failed.md",
  });
});

test("preview byte metadata is compact and deterministic", () => {
  assert.equal(formatAssetBytes(512), "512 B");
  assert.equal(formatAssetBytes(1_536), "1.5 KB");
  assert.equal(formatAssetBytes(1_572_864), "1.5 MB");
});
