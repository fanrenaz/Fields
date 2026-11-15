const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopSettingsStore, sanitizeDesktopSettings } = require("../../../desktop/settings-store.cjs");

test("Desktop settings default safely and reject non-boolean values", () => {
  assert.deepEqual(sanitizeDesktopSettings({}), { launchAtLogin: false, notificationsEnabled: true });
  assert.deepEqual(sanitizeDesktopSettings({ launchAtLogin: "yes", notificationsEnabled: false }), { launchAtLogin: false, notificationsEnabled: false });
});

test("Desktop settings persist atomically in userData", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fields-settings-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new DesktopSettingsStore(directory);
  await store.load();
  await store.update({ launchAtLogin: true, notificationsEnabled: false });
  const reloaded = new DesktopSettingsStore(directory);
  assert.deepEqual(await reloaded.load(), { launchAtLogin: true, notificationsEnabled: false });
});

test("Desktop settings report a controlled read failure without exposing the path", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fields-settings-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "desktop-settings.json"), "not-json");
  const events = [];
  const store = new DesktopSettingsStore(directory, (event, details) => events.push({ event, details }));
  await store.load();
  assert.deepEqual(events, [{
    event: "desktop.settings.load_failed",
    details: { status: "error", code: "settings_read_failed" },
  }]);
});
