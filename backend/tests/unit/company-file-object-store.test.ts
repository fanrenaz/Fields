import assert from "node:assert/strict";
import test from "node:test";

import { S3CompanyFileObjectStore } from "../../src/infrastructure/object-storage/company-file-object-store.js";

test("Company File presigned URLs select the explicit Browser or Runtime endpoint", async () => {
  const store = new S3CompanyFileObjectStore({
    bucket: "files",
    internalEndpoint: "http://rustfs:9000",
    publicEndpoint: "https://files.example.test",
    region: "us-east-1",
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
  });
  const browser = await store.presignGet({
    audience: "browser",
    key: "companies/company/blobs/hash",
    downloadName: "plan.txt",
    contentType: "text/plain",
    expiresInSeconds: 60,
  });
  const runtime = await store.presignGet({
    audience: "runtime",
    key: "companies/company/blobs/hash",
    downloadName: "plan.txt",
    contentType: "text/plain",
    expiresInSeconds: 60,
  });
  const runtimeUpload = await store.presignPut({
    audience: "runtime",
    key: "companies/company/blobs/hash",
    contentType: "text/plain",
    sha256: "a".repeat(64),
    expiresInSeconds: 60,
  });

  assert.equal(new URL(browser).host, "files.example.test");
  assert.equal(new URL(runtime).host, "rustfs:9000");
  assert.equal(new URL(runtimeUpload).host, "rustfs:9000");
});
