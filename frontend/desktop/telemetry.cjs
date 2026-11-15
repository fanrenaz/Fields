const { randomUUID } = require("node:crypto");

const DESKTOP_TELEMETRY_URL = "https://fields.example.com/api/v1/observability/desktop";
const MAX_QUEUE_SIZE = 256;
const MAX_BATCH_SIZE = 32;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
const EVENT_NAMES = new Set([
  "desktop.app.starting",
  "desktop.app.ready",
  "desktop.app.start_failed",
  "desktop.renderer.unresponsive",
  "desktop.renderer.recovered",
  "desktop.renderer.exited",
  "desktop.update.check_completed",
  "desktop.update.check_failed",
  "desktop.update.available",
  "desktop.update.download_completed",
  "desktop.update.download_failed",
  "desktop.update.install_started",
  "desktop.update.install_failed",
  "desktop.update.cleanup_failed",
  "desktop.runtime.state_invalid",
  "desktop.runtime.trial_rolled_back",
  "desktop.runtime.release_invalid",
  "desktop.runtime.trial_healthy",
  "desktop.settings.load_failed",
  "desktop.browser.tunnel_connected",
  "desktop.browser.tunnel_failed",
  "desktop.browser.tunnel_closed",
]);
const ERROR_CODES = new Set([
  "network",
  "http_error",
  "invalid_manifest",
  "invalid_signature",
  "shell_too_old",
  "runtime_unhealthy",
  "download_size_mismatch",
  "download_integrity_mismatch",
  "file_io",
  "renderer_crashed",
  "renderer_killed",
  "renderer_oom",
  "renderer_launch_failed",
  "proxy_unavailable",
  "tunnel_connection_lost",
  "settings_read_failed",
  "unknown",
]);

class DesktopTelemetry {
  constructor({
    version,
    fetch,
    platform = process.platform,
    arch = process.arch,
    now = Date.now,
    sessionId = randomUUID(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    this.version = version;
    this.fetch = fetch;
    this.platform = platform;
    this.arch = arch;
    this.now = now;
    this.sessionId = sessionId;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.queue = [];
    this.droppedCount = 0;
    this.authenticated = false;
    this.everAuthenticated = false;
    this.epoch = 0;
    this.inFlight = false;
    this.retryIndex = 0;
    this.retryTimer = null;
  }

  record(event, { status = "ok", code = null, durationMs = null } = {}) {
    if (!EVENT_NAMES.has(event)) return;
    const safeStatus = status === "error" ? "error" : "ok";
    const safeCode = safeStatus === "error" && ERROR_CODES.has(code) ? code : null;
    const safeDuration = Number.isFinite(durationMs)
      ? Math.max(0, Math.min(Math.round(durationMs), 900_000))
      : null;
    this.queue.push({
      epoch: this.epoch,
      record: {
        schema_version: 1,
        event,
        occurred_at_ms: this.now(),
        status: safeStatus,
        code: safeCode,
        duration_ms: safeDuration,
        desktop_session_id: this.sessionId,
        platform: this.platform,
        arch: this.arch,
      },
    });
    while (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue.shift();
      this.droppedCount = Math.min(1_000_000, this.droppedCount + 1);
    }
    if (this.authenticated) void this.flush();
  }

  setAuthenticated(active) {
    if (active === true) {
      this.authenticated = true;
      this.everAuthenticated = true;
      this.retryIndex = 0;
      this.cancelRetry();
      void this.flush();
      return;
    }
    if (!this.everAuthenticated) return;
    const oldEpoch = this.epoch;
    this.authenticated = false;
    this.epoch += 1;
    this.queue = this.queue.filter((entry) => entry.epoch !== oldEpoch);
    this.droppedCount = 0;
    this.retryIndex = 0;
    this.cancelRetry();
  }

  async flush() {
    if (!this.authenticated || this.inFlight || this.queue.length === 0) return;
    const epoch = this.epoch;
    const entries = this.queue.filter((entry) => entry.epoch === epoch).slice(0, MAX_BATCH_SIZE);
    if (entries.length === 0) return;
    const droppedCount = this.droppedCount;
    this.inFlight = true;
    try {
      const response = await this.fetch(DESKTOP_TELEMETRY_URL, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ records: entries.map((entry) => entry.record), dropped_count: droppedCount }),
      });
      if (response.status === 202) {
        this.removeEntries(entries);
        if (this.epoch === epoch) this.droppedCount = 0;
        this.retryIndex = 0;
      } else if (response.status === 401 || response.status === 403) {
        this.authenticated = false;
      } else if (response.status === 429 || response.status >= 500) {
        this.scheduleRetry();
      } else {
        this.removeEntries(entries);
        this.droppedCount = Math.min(1_000_000, this.droppedCount + entries.length);
      }
    } catch {
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
    }
    if (this.authenticated && !this.retryTimer && this.queue.some((entry) => entry.epoch === this.epoch)) {
      queueMicrotask(() => void this.flush());
    }
  }

  removeEntries(entries) {
    const sent = new Set(entries);
    this.queue = this.queue.filter((entry) => !sent.has(entry));
  }

  scheduleRetry() {
    if (this.retryTimer || !this.authenticated) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.retryIndex, RETRY_DELAYS_MS.length - 1)];
    this.retryIndex += 1;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  cancelRetry() {
    if (this.retryTimer) this.clearTimer(this.retryTimer);
    this.retryTimer = null;
  }
}

function installDesktopClientHeaders(targetSession, { origin, version, runtimeRelease = null }) {
  targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (isFieldsProductRequest(details.url, origin)) {
      headers["X-Fields-Client-Kind"] = "desktop";
      headers["X-Fields-Client-Version"] = version;
      if (/^[0-9a-f]{40}$/u.test(runtimeRelease ?? "")) headers["X-Fields-Runtime-Release"] = runtimeRelease;
    }
    callback({ requestHeaders: headers });
  });
}

function isFieldsProductRequest(value, origin) {
  try {
    const url = new URL(value);
    const expected = new URL(origin);
    if (url.hostname !== expected.hostname || url.port || !["https:", "wss:"].includes(url.protocol)) return false;
    return ["/api", "/embodiment", "/desktop"].some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
  } catch {
    return false;
  }
}

function rendererExitCode(reason) {
  if (reason === "crashed") return "renderer_crashed";
  if (reason === "killed") return "renderer_killed";
  if (reason === "oom") return "renderer_oom";
  if (reason === "launch-failed" || reason === "integrity-failure") return "renderer_launch_failed";
  return "unknown";
}

module.exports = {
  DESKTOP_TELEMETRY_URL,
  DesktopTelemetry,
  installDesktopClientHeaders,
  isFieldsProductRequest,
  rendererExitCode,
};
