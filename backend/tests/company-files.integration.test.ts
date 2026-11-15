import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { S3CompanyFileObjectStore } from "../src/infrastructure/object-storage/company-file-object-store.js";

const optIn = process.env.FIELDS_REAL_COMPANY_FILES_INTEGRATION_TEST === "1";
const required = [
  "FIELDS_COMPANY_FILES_BUCKET",
  "FIELDS_OBJECT_STORAGE_INTERNAL_ENDPOINT",
  "FIELDS_OBJECT_STORAGE_PUBLIC_ENDPOINT",
  "FIELDS_COMPANY_FILES_ACCESS_KEY_ID",
  "FIELDS_COMPANY_FILES_SECRET_ACCESS_KEY",
] as const;
const missing = required.filter((name) => !process.env[name]?.trim());

test("real RustFS accepts and returns a verified Company File object", {
  skip: !optIn
    ? "Set FIELDS_REAL_COMPANY_FILES_INTEGRATION_TEST=1 to run real RustFS integration."
    : missing.length > 0
      ? `Missing required real RustFS configuration: ${missing.join(", ")}`
      : false,
}, async () => {
  assert.deepEqual(missing, []);
  const bytes = Buffer.from(`Fields Company File integration ${randomUUID()}\n`, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const store = new S3CompanyFileObjectStore({
    bucket: process.env.FIELDS_COMPANY_FILES_BUCKET!,
    internalEndpoint: process.env.FIELDS_OBJECT_STORAGE_INTERNAL_ENDPOINT!,
    publicEndpoint: process.env.FIELDS_OBJECT_STORAGE_PUBLIC_ENDPOINT!,
    region: process.env.FIELDS_OBJECT_STORAGE_REGION ?? "us-east-1",
    accessKeyId: process.env.FIELDS_COMPANY_FILES_ACCESS_KEY_ID!,
    secretAccessKey: process.env.FIELDS_COMPANY_FILES_SECRET_ACCESS_KEY!,
  });
  const key = store.objectKey(`integration_${randomUUID().replaceAll("-", "")}`, sha256);
  try {
    const uploadUrl = await store.presignPut({
      audience: "runtime",
      key,
      contentType: "text/plain",
      sha256,
      expiresInSeconds: 60,
    });
    const uploaded = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": "text/plain",
        "x-amz-meta-sha256": sha256,
      },
      body: bytes,
    });
    assert.equal(uploaded.ok, true, `RustFS PUT returned ${uploaded.status}.`);
    assert.deepEqual(await store.head(key), { sizeBytes: bytes.byteLength, sha256 });

    const downloadUrl = await store.presignGet({
      audience: "runtime",
      key,
      downloadName: "integration.txt",
      contentType: "text/plain",
      expiresInSeconds: 60,
    });
    const downloaded = await fetch(downloadUrl, { redirect: "error" });
    assert.equal(downloaded.ok, true, `RustFS GET returned ${downloaded.status}.`);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  } finally {
    await store.delete(key);
  }
});
