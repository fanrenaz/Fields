const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { compareVersions, validateChannel, validateRuntimeManifest, verifySignedJson } = require("./runtime-contract.cjs");

const PRODUCTION_ORIGIN = "https://fields.example.com";
const CHANNEL_URL = `${PRODUCTION_ORIGIN}/desktop/runtime/channels/stable.json`;
const STATE_KEYS = ["current", "highest_sequence", "pending", "previous", "schema_version", "trial"];
const RELEASE_PATTERN = /^[0-9a-f]{40}$/u;

function defaultState() { return { schema_version: 1, current: null, previous: null, pending: null, trial: null, highest_sequence: 0 }; }
function nullableRelease(value) { return value === null || RELEASE_PATTERN.test(value); }

function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== STATE_KEYS.length || !keys.every((key, index) => key === STATE_KEYS[index])) return null;
  if (value.schema_version !== 1 || !nullableRelease(value.current) || !nullableRelease(value.previous) || !nullableRelease(value.pending) || !nullableRelease(value.trial)) return null;
  if (!Number.isSafeInteger(value.highest_sequence) || value.highest_sequence < 0) return null;
  return { ...value };
}

async function responseBytes(response) {
  if (!response.ok) throw runtimeError("http_error", `Runtime request failed with HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

class DesktopRuntimeStore {
  constructor({ userData, builtinRoot, shellVersion, net, publicKeys, fileSystem = fsPromises, reportTelemetry = () => undefined }) {
    this.root = path.join(userData, "runtime");
    this.objectsRoot = path.join(this.root, "objects", "sha256");
    this.releasesRoot = path.join(this.root, "releases");
    this.statePath = path.join(this.root, "state.json");
    this.builtinRoot = builtinRoot;
    this.shellVersion = shellVersion;
    this.net = net;
    this.publicKeys = publicKeys;
    this.fs = fileSystem;
    this.reportTelemetry = reportTelemetry;
    this.state = defaultState();
  }

  async initialize() {
    await this.fs.mkdir(this.objectsRoot, { recursive: true, mode: 0o700 });
    await this.fs.mkdir(this.releasesRoot, { recursive: true, mode: 0o700 });
    try {
      const parsed = validateState(JSON.parse(await this.fs.readFile(this.statePath, "utf8")));
      if (!parsed) throw new Error("invalid runtime state");
      this.state = parsed;
    } catch (error) {
      if (error?.code !== "ENOENT") this.reportTelemetry("desktop.runtime.state_invalid", { status: "error", code: "invalid_manifest" });
      this.state = defaultState();
      await this.writeState();
    }

    if (this.state.trial) {
      const failedTrial = this.state.trial;
      this.state.trial = null;
      this.state.pending = null;
      this.state.current = this.state.previous;
      this.state.previous = null;
      await this.writeState();
      this.reportTelemetry("desktop.runtime.trial_rolled_back", { status: "error", code: "runtime_unhealthy", releaseId: failedTrial });
    }
  }

  async writeState() {
    const temporary = `${this.statePath}.tmp-${process.pid}-${randomUUID()}`;
    let renamed = false;
    try {
      await this.fs.writeFile(temporary, `${JSON.stringify(this.state)}\n`, { flag: "wx", mode: 0o600 });
      await this.fs.rename(temporary, this.statePath);
      renamed = true;
    } finally {
      if (!renamed) await this.fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  releaseRoot(releaseId) { return path.join(this.releasesRoot, releaseId); }

  async selectRuntime() {
    if (this.state.pending) {
      this.state.previous = this.state.current;
      this.state.trial = this.state.pending;
      this.state.pending = null;
      await this.writeState();
    }
    const candidates = [this.state.trial, this.state.current, this.state.previous].filter(Boolean);
    for (const releaseId of [...new Set(candidates)]) {
      const release = await this.validateInstalledRelease(releaseId).catch(() => null);
      if (release) {
        if (this.state.trial && releaseId !== this.state.trial) {
          this.state.trial = null;
          this.state.pending = null;
          this.state.current = releaseId;
          this.state.previous = null;
          await this.writeState();
        } else if (!this.state.trial && releaseId !== this.state.current) {
          this.state.current = releaseId;
          this.state.previous = null;
          await this.writeState();
        }
        return this.selection(release);
      }
      this.reportTelemetry("desktop.runtime.release_invalid", { status: "error", code: "download_integrity_mismatch", releaseId });
    }
    if (candidates.length > 0) {
      this.state.current = null;
      this.state.previous = null;
      this.state.pending = null;
      this.state.trial = null;
      await this.writeState();
    }
    return this.builtinSelection();
  }

  selection(manifest) {
    const runtimeRoot = this.releaseRoot(manifest.release_id);
    return {
      runtimeRoot,
      rendererRoot: path.join(runtimeRoot, "artifacts", "renderer"),
      preloadPath: path.join(runtimeRoot, "desktop", "preload.cjs"),
      mainPath: path.join(runtimeRoot, "desktop", "runtime-main.cjs"),
      release: { releaseId: manifest.release_id, releaseSequence: manifest.release_sequence, builtin: false },
    };
  }

  builtinSelection() {
    return {
      runtimeRoot: this.builtinRoot,
      rendererRoot: path.join(this.builtinRoot, "artifacts", "renderer"),
      preloadPath: path.join(this.builtinRoot, "desktop", "preload.cjs"),
      mainPath: path.join(this.builtinRoot, "desktop", "runtime-main.cjs"),
      release: { releaseId: null, releaseSequence: 0, builtin: true },
    };
  }

  async markHealthy(releaseId) {
    if (!releaseId || this.state.trial !== releaseId) return;
    this.state.previous = this.state.current;
    this.state.current = releaseId;
    this.state.trial = null;
    await this.writeState();
    this.reportTelemetry("desktop.runtime.trial_healthy", { releaseId });
  }

  async markFailed(releaseId) {
    if (!releaseId) return;
    if (this.state.trial === releaseId) {
      this.state.trial = null;
      this.state.current = this.state.previous;
      this.state.previous = null;
    } else if (this.state.current === releaseId) {
      this.state.current = this.state.previous;
      this.state.previous = null;
    }
    await this.writeState();
  }

  async fetchSignedJson(url, signal) {
    const [documentResponse, signatureResponse] = await Promise.all([
      this.net.fetch(url, { cache: "no-store", signal }),
      this.net.fetch(`${url}.sig`, { cache: "no-store", signal }),
    ]);
    const [raw, signatureRaw] = await Promise.all([responseBytes(documentResponse), responseBytes(signatureResponse)]);
    let sidecar;
    try { sidecar = JSON.parse(signatureRaw.toString("utf8")); } catch { throw runtimeError("invalid_signature", "Runtime signature sidecar is invalid."); }
    const value = verifySignedJson(raw, sidecar, this.publicKeys);
    if (!value) throw runtimeError("invalid_signature", "Runtime signature verification failed.");
    return { raw, signatureRaw, value };
  }

  async check(signal) {
    const signed = await this.fetchSignedJson(CHANNEL_URL, signal);
    const channel = validateChannel(signed.value);
    if (!channel) throw runtimeError("invalid_manifest", "Runtime channel is invalid.");
    if (channel.release_sequence <= this.state.highest_sequence) return null;
    return channel;
  }

  async install(channel, { signal, onProgress = () => undefined } = {}) {
    const channelValue = validateChannel(channel);
    if (!channelValue || channelValue.release_sequence <= this.state.highest_sequence) throw runtimeError("invalid_manifest", "Runtime channel is stale or invalid.");
    const signed = await this.fetchSignedJson(new URL(channelValue.manifest_url, PRODUCTION_ORIGIN), signal);
    const digest = crypto.createHash("sha256").update(signed.raw).digest("hex");
    if (digest !== channelValue.manifest_sha256) throw runtimeError("download_integrity_mismatch", "Runtime manifest digest mismatch.");
    const manifest = validateRuntimeManifest(signed.value);
    if (!manifest || manifest.release_id !== channelValue.release_id || manifest.release_sequence !== channelValue.release_sequence) throw runtimeError("invalid_manifest", "Runtime manifest does not match its channel.");
    if (compareVersions(this.shellVersion, manifest.min_shell_version) < 0) throw runtimeError("shell_too_old", "Runtime requires a newer Desktop shell.");

    const uniqueFiles = [...new Map(manifest.files.map((file) => [file.sha256, file])).values()];
    const digestWeights = new Map();
    for (const file of manifest.files) digestWeights.set(file.sha256, (digestWeights.get(file.sha256) ?? 0) + file.size_bytes);
    let completed = 0;
    const queue = [...uniqueFiles];
    const worker = async () => {
      while (queue.length) {
        const file = queue.shift();
        await this.ensureObject(file, signal);
        completed += digestWeights.get(file.sha256);
        onProgress(Math.min(completed, manifest.total_size_bytes), manifest.total_size_bytes);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    await this.materializeRelease(manifest, signed.raw, signed.signatureRaw);
    this.state.pending = manifest.release_id;
    this.state.highest_sequence = manifest.release_sequence;
    await this.writeState();
    return manifest;
  }

  objectPath(digest) { return path.join(this.objectsRoot, digest); }

  async validFile(filePath, expected) {
    try {
      const stat = await this.fs.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.size_bytes) return false;
      const bytes = await this.fs.readFile(filePath);
      return crypto.createHash("sha256").update(bytes).digest("hex") === expected.sha256;
    } catch { return false; }
  }

  async ensureObject(file, signal) {
    const destination = this.objectPath(file.sha256);
    if (await this.validFile(destination, file)) return;
    await this.fs.rm(destination, { force: true });
    const temporary = `${destination}.part-${process.pid}-${randomUUID()}`;
    let handle;
    try {
      const response = await this.net.fetch(new URL(file.url, PRODUCTION_ORIGIN), { cache: "no-store", signal });
      if (!response.ok || !response.body) throw runtimeError("http_error", "Runtime object download failed.");
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length !== file.size_bytes) throw runtimeError("download_size_mismatch", "Runtime object length mismatch.");
      handle = await this.fs.open(temporary, "wx", 0o600);
      const hash = crypto.createHash("sha256"); let received = 0;
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk); received += buffer.length;
        if (received > file.size_bytes) throw runtimeError("download_size_mismatch", "Runtime object exceeded its declared size.");
        hash.update(buffer); await handle.write(buffer);
      }
      await handle.close(); handle = null;
      if (received !== file.size_bytes || hash.digest("hex") !== file.sha256) throw runtimeError("download_integrity_mismatch", "Runtime object integrity mismatch.");
      await this.fs.rename(temporary, destination).catch(async (error) => {
        if (error?.code !== "EEXIST" || !await this.validFile(destination, file)) throw error;
      });
    } finally {
      await handle?.close().catch(() => undefined);
      await this.fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async materializeRelease(manifest, rawManifest, rawSignature) {
    const destination = this.releaseRoot(manifest.release_id);
    if (await this.validateInstalledRelease(manifest.release_id).catch(() => null)) return;
    await this.fs.rm(destination, { recursive: true, force: true });
    const temporary = `${destination}.part-${process.pid}-${randomUUID()}`;
    await this.fs.mkdir(temporary, { recursive: false, mode: 0o700 });
    try {
      for (const file of manifest.files) {
        const output = path.join(temporary, ...file.path.split("/"));
        await this.fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
        await this.fs.copyFile(this.objectPath(file.sha256), output, fs.constants.COPYFILE_EXCL);
      }
      await this.fs.writeFile(path.join(temporary, ".manifest.json"), rawManifest, { flag: "wx", mode: 0o600 });
      await this.fs.writeFile(path.join(temporary, ".manifest.json.sig"), rawSignature, { flag: "wx", mode: 0o600 });
      await this.fs.rename(temporary, destination);
    } finally {
      await this.fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async validateInstalledRelease(releaseId) {
    if (!RELEASE_PATTERN.test(releaseId)) return null;
    const root = this.releaseRoot(releaseId);
    const raw = await this.fs.readFile(path.join(root, ".manifest.json"));
    const signatureRaw = await this.fs.readFile(path.join(root, ".manifest.json.sig"));
    let sidecar; try { sidecar = JSON.parse(signatureRaw.toString("utf8")); } catch { return null; }
    const manifest = validateRuntimeManifest(verifySignedJson(raw, sidecar, this.publicKeys));
    if (!manifest || manifest.release_id !== releaseId || compareVersions(this.shellVersion, manifest.min_shell_version) < 0) return null;
    for (const file of manifest.files) if (!await this.validFile(path.join(root, ...file.path.split("/")), file)) return null;
    return manifest;
  }
}

function runtimeError(code, message) { const error = new Error(message); error.telemetryCode = code; return error; }

module.exports = { CHANNEL_URL, DesktopRuntimeStore, defaultState, validateState };
