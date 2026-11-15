import assert from "node:assert/strict";
import test from "node:test";

import {
  createCompanyFileShareToken,
  verifyCompanyFileShareToken,
} from "../../src/infrastructure/persistence/postgres/repositories/company/company-file-repository.js";

const secret = "unit-test-company-file-share-secret-32";

test("Company File share tokens are reproducible and reject tampering", () => {
  const token = createCompanyFileShareToken("file_share_one", secret);
  assert.equal(verifyCompanyFileShareToken(token, secret), "file_share_one");
  assert.equal(verifyCompanyFileShareToken(`${token}x`, secret), null);
  assert.equal(verifyCompanyFileShareToken(token, `${secret}-different`), null);
  assert.equal(verifyCompanyFileShareToken("missing-signature", secret), null);
});
