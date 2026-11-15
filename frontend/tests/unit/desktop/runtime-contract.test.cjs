const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  compareVersions,
  safeRuntimePath,
  validateChannel,
  validateRuntimeManifest,
  verifySignedJson,
} = require("../../../desktop/runtime-contract.cjs");

const releaseId = "a".repeat(40);
const digest = "b".repeat(64);

function manifest() {
  const files = ["desktop/runtime-main.cjs", "desktop/preload.cjs", "artifacts/renderer/index.html"].map((path) => ({
    path,
    sha256: digest,
    size_bytes: 2,
    url: `/desktop/runtime/objects/sha256/${digest}`,
  }));
  return { schema_version: 1, release_id: releaseId, release_sequence: 4, source_sha: releaseId, runtime_api_version: 1, min_shell_version: "1.0.25", files, total_size_bytes: 6 };
}

test("Runtime signatures cover the exact raw JSON bytes with the pinned key id", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const raw = Buffer.from(JSON.stringify({ hello: "runtime" }));
  const sidecar = { schema_version: 1, key_id: "runtime-ed25519-v1", signature_base64: crypto.sign(null, raw, privateKey).toString("base64") };
  const keys = { "runtime-ed25519-v1": publicKey.export({ type: "spki", format: "pem" }) };
  assert.deepEqual(verifySignedJson(raw, sidecar, keys), { hello: "runtime" });
  assert.equal(verifySignedJson(Buffer.concat([raw, Buffer.from("\n")]), sidecar, keys), null);
  assert.equal(verifySignedJson(raw, { ...sidecar, extra: true }, keys), null);
});

test("Runtime channel and manifest contracts reject unknown fields and unsafe paths", () => {
  const channel = { schema_version: 1, channel: "stable", release_id: releaseId, release_sequence: 4, manifest_url: `/desktop/runtime/releases/${releaseId}/manifest.json`, manifest_sha256: digest, published_at_ms: 1 };
  assert.deepEqual(validateChannel(channel), channel);
  assert.equal(validateChannel({ ...channel, latest: true }), null);
  assert.ok(validateRuntimeManifest(manifest()));
  assert.equal(validateRuntimeManifest({ ...manifest(), extra: true }), null);
  const nonStringPath = manifest();
  nonStringPath.files[0] = { ...nonStringPath.files[0], path: 42 };
  assert.equal(validateRuntimeManifest(nonStringPath), null);
  for (const unsafe of ["../desktop/main.cjs", "/desktop/main.cjs", "desktop\\main.cjs", "desktop//main.cjs", "desktop/CON.js", "desktop/main.cjs."]) assert.equal(safeRuntimePath(unsafe), false);
  const unsafeManifest = manifest();
  unsafeManifest.files[0] = { ...unsafeManifest.files[0], path: "../desktop/runtime-main.cjs" };
  assert.equal(validateRuntimeManifest(unsafeManifest), null);
  const duplicateManifest = manifest();
  duplicateManifest.files.push({ ...duplicateManifest.files[0], path: "DESKTOP/RUNTIME-MAIN.CJS" });
  duplicateManifest.total_size_bytes += duplicateManifest.files[0].size_bytes;
  assert.equal(validateRuntimeManifest(duplicateManifest), null);
});

test("Runtime shell version comparison is numeric", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.25", "1.0.25"), 0);
  assert.equal(compareVersions("1.0.24", "1.0.25"), -1);
});
