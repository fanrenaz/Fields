const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  launchAtLogin: false,
  notificationsEnabled: true,
});

class DesktopSettingsStore {
  constructor(userDataPath, reportTelemetry = () => undefined) {
    this.filePath = path.join(userDataPath, "desktop-settings.json");
    this.value = { ...DEFAULT_DESKTOP_SETTINGS };
    this.reportTelemetry = reportTelemetry;
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.value = sanitizeDesktopSettings(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.error("desktop.settings.load_failed", { code: error?.code ?? "unknown" });
        this.reportTelemetry("desktop.settings.load_failed", { status: "error", code: "settings_read_failed" });
      }
    }
    return this.get();
  }

  get() { return { ...this.value }; }

  async update(input) {
    this.value = sanitizeDesktopSettings({ ...this.value, ...input });
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(this.value)}\n`, { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
    return this.get();
  }
}

function sanitizeDesktopSettings(value) {
  return {
    launchAtLogin: value?.launchAtLogin === true,
    notificationsEnabled: value?.notificationsEnabled !== false,
  };
}

module.exports = { DEFAULT_DESKTOP_SETTINGS, DesktopSettingsStore, sanitizeDesktopSettings };
