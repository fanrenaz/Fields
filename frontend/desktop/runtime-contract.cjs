const crypto = require("node:crypto");

const KEY_ID = "runtime-ed25519-v1";
const RELEASE_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function safeRuntimePath(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0") || /[<>:"|?*]/u.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => {
    if (!part || part === "." || part === ".." || /[. ]$/u.test(part)) return false;
    return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part);
  });
}

function validateSignatureSidecar(value) {
  if (!exactObject(value, ["schema_version", "key_id", "signature_base64"])) return null;
  if (value.schema_version !== 1 || value.key_id !== KEY_ID) return null;
  if (typeof value.signature_base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.signature_base64)) return null;
  const signature = Buffer.from(value.signature_base64, "base64");
  return signature.byteLength === 64 ? { ...value, signature } : null;
}

function verifySignedJson(rawBytes, sidecarValue, publicKeys) {
  const sidecar = validateSignatureSidecar(sidecarValue);
  const publicKey = sidecar ? publicKeys?.[sidecar.key_id] : null;
  if (!sidecar || typeof publicKey !== "string") return null;
  if (!crypto.verify(null, rawBytes, publicKey, sidecar.signature)) return null;
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes)); } catch { return null; }
}

function validateChannel(value) {
  const keys = ["schema_version", "channel", "release_id", "release_sequence", "manifest_url", "manifest_sha256", "published_at_ms"];
  if (!exactObject(value, keys) || value.schema_version !== 1 || value.channel !== "stable") return null;
  if (!RELEASE_PATTERN.test(value.release_id) || !Number.isSafeInteger(value.release_sequence) || value.release_sequence <= 0) return null;
  if (value.manifest_url !== `/desktop/runtime/releases/${value.release_id}/manifest.json`) return null;
  if (!SHA256_PATTERN.test(value.manifest_sha256) || !Number.isSafeInteger(value.published_at_ms) || value.published_at_ms < 0) return null;
  return { ...value };
}

function validateRuntimeManifest(value) {
  const keys = ["schema_version", "release_id", "release_sequence", "source_sha", "runtime_api_version", "min_shell_version", "files", "total_size_bytes"];
  if (!exactObject(value, keys) || value.schema_version !== 1 || value.runtime_api_version !== 1) return null;
  if (!RELEASE_PATTERN.test(value.release_id) || value.source_sha !== value.release_id) return null;
  if (!Number.isSafeInteger(value.release_sequence) || value.release_sequence <= 0 || !SEMVER_PATTERN.test(value.min_shell_version)) return null;
  if (!Array.isArray(value.files) || value.files.length < 3 || value.files.length > 20_000) return null;
  const paths = new Set();
  let total = 0;
  const files = [];
  for (const file of value.files) {
    if (!exactObject(file, ["path", "sha256", "size_bytes", "url"])) return null;
    if (!safeRuntimePath(file.path)) return null;
    const comparablePath = file.path.toLowerCase();
    if (paths.has(comparablePath) || [".manifest.json", ".manifest.json.sig"].includes(comparablePath) || !SHA256_PATTERN.test(file.sha256)) return null;
    if (!Number.isSafeInteger(file.size_bytes) || file.size_bytes < 0) return null;
    if (file.url !== `/desktop/runtime/objects/sha256/${file.sha256}`) return null;
    paths.add(comparablePath); total += file.size_bytes;
    if (!Number.isSafeInteger(total)) return null;
    files.push({ ...file });
  }
  if (total !== value.total_size_bytes || !paths.has("desktop/runtime-main.cjs") || !paths.has("desktop/preload.cjs") || !paths.has("artifacts/renderer/index.html")) return null;
  return { ...value, files };
}

function compareVersions(left, right) {
  const a = SEMVER_PATTERN.exec(left)?.slice(1).map(BigInt);
  const b = SEMVER_PATTERN.exec(right)?.slice(1).map(BigInt);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

module.exports = { KEY_ID, compareVersions, safeRuntimePath, validateChannel, validateRuntimeManifest, validateSignatureSidecar, verifySignedJson };
