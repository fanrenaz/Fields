import assert from "node:assert/strict";
import test from "node:test";

import {
  companyAssetMutationFingerprint,
} from "../../../../../../src/infrastructure/persistence/postgres/repositories/company/company-asset-repository.js";

test("asset idempotency fingerprints distinguish bearer tokens without exposing them", () => {
  const firstToken = "first-sensitive-token";
  const secondToken = "second-sensitive-token";
  const request = {
    asset_id: "asset_one",
    bearer_token: firstToken,
    target: {
      type: "version",
      version_id: "version_one",
      expected_revision: 1,
    },
  };

  const first = companyAssetMutationFingerprint("mcp.credential.replace", request);
  const replay = companyAssetMutationFingerprint("mcp.credential.replace", {
    ...request,
  });
  const changed = companyAssetMutationFingerprint("mcp.credential.replace", {
    ...request,
    bearer_token: secondToken,
  });
  const cleared = companyAssetMutationFingerprint("mcp.credential.replace", {
    ...request,
    bearer_token: null,
  });

  assert.equal(first, replay);
  assert.notEqual(first, changed);
  assert.notEqual(first, cleared);
  assert.match(first, /^[0-9a-f]{64}$/u);
  assert.equal(first.includes(firstToken), false);
  assert.equal(changed.includes(secondToken), false);
});
