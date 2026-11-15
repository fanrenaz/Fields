const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { CHANNEL_URL, DesktopRuntimeStore } = require("../../../desktop/runtime-store.cjs");

function signed(value, privateKey) {
  const raw = Buffer.from(JSON.stringify(value));
  return {
    raw,
    sidecar: Buffer.from(JSON.stringify({ schema_version: 1, key_id: "runtime-ed25519-v1", signature_base64: crypto.sign(null, raw, privateKey).toString("base64") })),
  };
}

function fixture() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const releaseId = "a".repeat(40);
  const contents = new Map([
    ["desktop/runtime-main.cjs", Buffer.from("module.exports={startDesktopRuntime(){}}")],
    ["desktop/preload.cjs", Buffer.from("preload")],
    ["artifacts/renderer/index.html", Buffer.from("<!doctype html>")],
  ]);
  const files = [...contents].map(([filePath, bytes]) => {
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    return { path: filePath, sha256, size_bytes: bytes.length, url: `/desktop/runtime/objects/sha256/${sha256}` };
  });
  const manifest = { schema_version: 1, release_id: releaseId, release_sequence: 11, source_sha: releaseId, runtime_api_version: 1, min_shell_version: "1.0.25", files, total_size_bytes: files.reduce((sum, file) => sum + file.size_bytes, 0) };
  const signedManifest = signed(manifest, privateKey);
  const channel = { schema_version: 1, channel: "stable", release_id: releaseId, release_sequence: 11, manifest_url: `/desktop/runtime/releases/${releaseId}/manifest.json`, manifest_sha256: crypto.createHash("sha256").update(signedManifest.raw).digest("hex"), published_at_ms: 1 };
  const signedChannel = signed(channel, privateKey);
  const responses = new Map([
    [CHANNEL_URL, signedChannel.raw],
    [`${CHANNEL_URL}.sig`, signedChannel.sidecar],
    [`https://fields.example.com${channel.manifest_url}`, signedManifest.raw],
    [`https://fields.example.com${channel.manifest_url}.sig`, signedManifest.sidecar],
  ]);
  for (const file of files) responses.set(`https://fields.example.com${file.url}`, contents.get(file.path));
  return { channel, manifest, publicKeys: { "runtime-ed25519-v1": publicKey.export({ type: "spki", format: "pem" }) }, responses };
}

function fakeNet(responses) {
  return { fetch: async (input) => {
    const bytes = responses.get(String(input));
    return bytes ? new Response(bytes, { headers: { "content-length": String(bytes.length) } }) : new Response("missing", { status: 404 });
  } };
}

test("Runtime store verifies, materializes, trials, and commits a signed release", async (context) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "fields-runtime-"));
  context.after(() => fs.rm(userData, { recursive: true, force: true }));
  const value = fixture();
  const telemetry = [];
  const store = new DesktopRuntimeStore({ userData, builtinRoot: "/builtin", shellVersion: "1.0.25", net: fakeNet(value.responses), publicKeys: value.publicKeys, reportTelemetry: (event) => telemetry.push(event) });
  await store.initialize();
  const channel = await store.check();
  const progress = [];
  await store.install(channel, { onProgress: (received, total) => progress.push([received, total]) });
  assert.equal(store.state.pending, value.manifest.release_id);
  assert.deepEqual(progress.at(-1), [value.manifest.total_size_bytes, value.manifest.total_size_bytes]);
  const selected = await store.selectRuntime();
  assert.equal(selected.release.releaseId, value.manifest.release_id);
  assert.equal(store.state.trial, value.manifest.release_id);
  await store.markHealthy(value.manifest.release_id);
  assert.equal(store.state.current, value.manifest.release_id);
  assert.equal(store.state.trial, null);
  assert.ok(telemetry.includes("desktop.runtime.trial_healthy"));
});

test("Runtime store rolls an unconfirmed trial back before selecting content", async (context) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "fields-runtime-rollback-"));
  context.after(() => fs.rm(userData, { recursive: true, force: true }));
  const value = fixture();
  const telemetry = [];
  const store = new DesktopRuntimeStore({ userData, builtinRoot: "/builtin", shellVersion: "1.0.25", net: fakeNet(value.responses), publicKeys: value.publicKeys, reportTelemetry: (event) => telemetry.push(event) });
  await store.initialize();
  await store.install(await store.check());
  await store.selectRuntime();

  const restarted = new DesktopRuntimeStore({ userData, builtinRoot: "/builtin", shellVersion: "1.0.25", net: fakeNet(value.responses), publicKeys: value.publicKeys, reportTelemetry: (event) => telemetry.push(event) });
  await restarted.initialize();
  assert.equal(restarted.state.trial, null);
  assert.equal((await restarted.selectRuntime()).release.builtin, true);
  assert.ok(telemetry.includes("desktop.runtime.trial_rolled_back"));
});

test("Runtime store rejects signed content that requires a newer shell", async (context) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "fields-runtime-version-"));
  context.after(() => fs.rm(userData, { recursive: true, force: true }));
  const value = fixture();
  const store = new DesktopRuntimeStore({ userData, builtinRoot: "/builtin", shellVersion: "1.0.24", net: fakeNet(value.responses), publicKeys: value.publicKeys });
  await store.initialize();
  await assert.rejects(() => store.install(value.channel), (error) => error.telemetryCode === "shell_too_old");
});

test("Runtime store persists fallback after an installed current release becomes invalid", async (context) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "fields-runtime-invalid-current-"));
  context.after(() => fs.rm(userData, { recursive: true, force: true }));
  const value = fixture();
  const store = new DesktopRuntimeStore({
    userData,
    builtinRoot: "/builtin",
    shellVersion: "1.0.25",
    net: fakeNet(value.responses),
    publicKeys: value.publicKeys,
  });
  await store.initialize();
  await store.install(await store.check());
  await store.selectRuntime();
  await store.markHealthy(value.manifest.release_id);
  await fs.writeFile(path.join(
    userData,
    "runtime",
    "releases",
    value.manifest.release_id,
    "desktop",
    "runtime-main.cjs",
  ), "corrupted");

  assert.equal((await store.selectRuntime()).release.builtin, true);
  assert.equal(store.state.current, null);
  assert.equal(store.state.previous, null);
});
