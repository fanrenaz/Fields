const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DesktopTelemetry,
  installDesktopClientHeaders,
  isFieldsProductRequest,
  rendererExitCode,
} = require("../../../desktop/telemetry.cjs");

const sessionId = "01234567-89ab-4def-8123-456789abcdef";

function telemetry(fetch, timers = {}) {
  return new DesktopTelemetry({
    version: "1.0.15",
    fetch,
    platform: "win32",
    arch: "x64",
    now: () => 1_700_000_000_000,
    sessionId,
    ...timers,
  });
}

test("Desktop telemetry buffers before authentication and sends bounded structured batches", async () => {
  const requests = [];
  const current = telemetry(async (url, init) => {
    requests.push({ url, init });
    return { status: 202 };
  });
  current.record("desktop.app.starting");
  current.record("desktop.update.check_failed", { status: "error", code: "network", durationMs: 12.4 });
  assert.equal(requests.length, 0);
  current.setAuthenticated(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.records.length, 2);
  assert.deepEqual(body.records[1], {
    schema_version: 1,
    event: "desktop.update.check_failed",
    occurred_at_ms: 1_700_000_000_000,
    status: "error",
    code: "network",
    duration_ms: 12,
    desktop_session_id: sessionId,
    platform: "win32",
    arch: "x64",
  });
  assert.equal(current.queue.length, 0);
});

test("Desktop telemetry drops oldest overflow and never accepts arbitrary event data", () => {
  const current = telemetry(async () => ({ status: 202 }));
  for (let index = 0; index < 260; index += 1) current.record("desktop.app.ready");
  current.record("desktop.secret", { status: "error", code: "ECONNRESET" });
  assert.equal(current.queue.length, 256);
  assert.equal(current.droppedCount, 4);
});

test("Desktop telemetry retries transient failures and clears account-bound records on logout", async () => {
  const scheduled = [];
  let responseStatus = 500;
  const current = telemetry(async () => ({ status: responseStatus }), {
    setTimer: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
    clearTimer: () => undefined,
  });
  current.record("desktop.app.ready");
  current.setAuthenticated(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduled[0].delay, 1_000);
  responseStatus = 202;
  scheduled[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(current.queue.length, 0);
  current.record("desktop.renderer.unresponsive", { status: "error", code: "unknown" });
  current.setAuthenticated(false);
  assert.equal(current.queue.length, 0);
});

test("Desktop telemetry clears a paused unauthorized generation before another account can authenticate", async () => {
  let status = 401;
  const requests = [];
  const current = telemetry(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { status };
  });
  current.record("desktop.app.ready");
  current.setAuthenticated(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(current.queue.length, 1);
  current.setAuthenticated(false);
  assert.equal(current.queue.length, 0);
  status = 202;
  current.record("desktop.update.check_completed");
  current.setAuthenticated(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests.at(-1).records.map(({ event }) => event), ["desktop.update.check_completed"]);
});

test("Desktop request headers cover only exact Fields product traffic including WebSockets", () => {
  let listener;
  installDesktopClientHeaders({ webRequest: { onBeforeSendHeaders: (value) => { listener = value; } } }, {
    origin: "https://fields.example.com",
    version: "1.0.15",
    runtimeRelease: "a".repeat(40),
  });
  const apply = (url) => new Promise((resolve) => listener({ url, requestHeaders: { Existing: "yes" } }, resolve));
  return Promise.all([
    apply("https://fields.example.com/api/v1/trpc").then(({ requestHeaders }) => assert.equal(requestHeaders["X-Fields-Client-Kind"], "desktop")),
    apply("wss://fields.example.com/api/v1/trpc").then(({ requestHeaders }) => assert.equal(requestHeaders["X-Fields-Client-Version"], "1.0.15")),
    apply("https://fields.example.com/api/v1/trpc").then(({ requestHeaders }) => assert.equal(requestHeaders["X-Fields-Runtime-Release"], "a".repeat(40))),
    apply("https://auth.openai.com/api/login").then(({ requestHeaders }) => assert.equal(requestHeaders["X-Fields-Client-Kind"], undefined)),
  ]);
});

test("built-in Desktop content omits the external Runtime release header", async () => {
  let listener;
  installDesktopClientHeaders({ webRequest: { onBeforeSendHeaders: (value) => { listener = value; } } }, {
    origin: "https://fields.example.com",
    version: "1.0.25",
    runtimeRelease: null,
  });
  const result = await new Promise((resolve) => listener({ url: "https://fields.example.com/api/v1/trpc", requestHeaders: {} }, resolve));
  assert.equal(result.requestHeaders["X-Fields-Runtime-Release"], undefined);
});

test("Desktop request and renderer classifications stay controlled", () => {
  assert.equal(isFieldsProductRequest("https://fields.example.com/embodiment/socket", "https://fields.example.com"), true);
  assert.equal(isFieldsProductRequest("https://fields.example.com.evil.test/api", "https://fields.example.com"), false);
  assert.equal(rendererExitCode("oom"), "renderer_oom");
  assert.equal(rendererExitCode("abnormal-exit"), "unknown");
});
