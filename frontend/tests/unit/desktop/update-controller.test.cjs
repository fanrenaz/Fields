const assert = require("node:assert/strict");
const test = require("node:test");

const { DesktopUpdateController, telemetryErrorCode } = require("../../../desktop/update-controller.cjs");

test("Desktop Runtime updates check, download, and relaunch into pending content", async () => {
  const states = [];
  const telemetry = [];
  let relaunched = false;
  let exitCode = null;
  const channel = { release_id: "a".repeat(40), release_sequence: 7 };
  const manifest = { release_id: channel.release_id, release_sequence: channel.release_sequence };
  const controller = new DesktopUpdateController({
    app: {
      getVersion: () => "1.0.25",
      relaunch: () => { relaunched = true; },
      exit: (code) => { exitCode = code; },
    },
    store: {
      check: async () => channel,
      install: async (input, options) => {
        assert.equal(input, channel);
        options.onProgress(10, 20);
        options.onProgress(20, 20);
        return manifest;
      },
    },
    windowProvider: () => ({ isDestroyed: () => false, webContents: { send: (_channel, state) => states.push(state) } }),
    reportTelemetry: (event, details) => telemetry.push({ event, details }),
  });

  assert.deepEqual(await controller.check(), { status: "ready", releaseId: channel.release_id, releaseSequence: 7 });
  assert.deepEqual(states, [
    { status: "downloading", receivedBytes: 10, totalBytes: 20 },
    { status: "downloading", receivedBytes: 20, totalBytes: 20 },
    { status: "ready", releaseId: channel.release_id, releaseSequence: 7 },
  ]);
  assert.equal(await controller.install(), true);
  assert.equal(relaunched, true);
  assert.equal(exitCode, 0);
  assert.deepEqual(telemetry.map(({ event }) => event), [
    "desktop.update.check_completed",
    "desktop.update.available",
    "desktop.update.download_completed",
    "desktop.update.install_started",
  ]);
});

test("Desktop Runtime download cancellation restores the available state", async () => {
  let rejectInstall;
  const channel = { release_id: "b".repeat(40), release_sequence: 8 };
  const states = [];
  const controller = new DesktopUpdateController({
    app: { getVersion: () => "1.0.25" },
    store: {
      check: async () => channel,
      install: (_input, { signal }) => new Promise((_resolve, reject) => {
        rejectInstall = () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
        signal.addEventListener("abort", rejectInstall, { once: true });
      }),
    },
    windowProvider: () => ({ isDestroyed: () => false, webContents: { send: (_channel, state) => states.push(state) } }),
  });
  const checking = controller.check();
  await new Promise((resolve) => setImmediate(resolve));
  controller.cancel();
  await checking;
  assert.deepEqual(states.at(-1), { status: "available", currentVersion: "1.0.25", releaseId: channel.release_id, releaseSequence: 8 });
  assert.equal(typeof rejectInstall, "function");
});

test("Desktop Runtime telemetry maps integrity and filesystem failures", () => {
  assert.equal(telemetryErrorCode(Object.assign(new Error("bad signature"), { telemetryCode: "invalid_signature" })), "invalid_signature");
  assert.equal(telemetryErrorCode(Object.assign(new Error("locked"), { code: "EBUSY" })), "file_io");
  assert.equal(telemetryErrorCode(new TypeError("fetch failed")), "network");
});
