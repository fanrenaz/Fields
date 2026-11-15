class DesktopUpdateController {
  constructor({ app, store, windowProvider, reportTelemetry = () => undefined }) {
    this.app = app;
    this.store = store;
    this.windowProvider = windowProvider;
    this.reportTelemetry = reportTelemetry;
    this.available = null;
    this.abortController = null;
    this.state = null;
  }

  emit(state) {
    this.state = state;
    const window = this.windowProvider();
    if (window && !window.isDestroyed()) window.webContents.send("fields:update:state", state);
  }

  getState() { return this.state; }

  async check() {
    const startedAt = Date.now();
    try {
      const channel = await this.store.check();
      this.reportTelemetry("desktop.update.check_completed", { durationMs: Date.now() - startedAt });
      if (!channel) return null;
      this.available = channel;
      const state = { status: "available", currentVersion: this.app.getVersion(), releaseId: channel.release_id, releaseSequence: channel.release_sequence };
      this.state = state;
      this.reportTelemetry("desktop.update.available", { releaseId: channel.release_id });
      await this.download();
      return this.state;
    } catch (error) {
      this.reportTelemetry("desktop.update.check_failed", { status: "error", code: telemetryErrorCode(error), durationMs: Date.now() - startedAt });
      return null;
    }
  }

  async download() {
    if (!this.available || this.abortController) throw new Error("No Desktop Runtime update is available.");
    this.abortController = new AbortController();
    const startedAt = Date.now();
    try {
      const manifest = await this.store.install(this.available, {
        signal: this.abortController.signal,
        onProgress: (receivedBytes, totalBytes) => this.emit({ status: "downloading", receivedBytes, totalBytes }),
      });
      this.emit({ status: "ready", releaseId: manifest.release_id, releaseSequence: manifest.release_sequence });
      this.reportTelemetry("desktop.update.download_completed", { durationMs: Date.now() - startedAt, releaseId: manifest.release_id });
    } catch (error) {
      if (error?.name === "AbortError") this.emit({ status: "available", currentVersion: this.app.getVersion(), releaseId: this.available.release_id, releaseSequence: this.available.release_sequence });
      else {
        this.emit({ status: "error", operation: "download" });
        this.reportTelemetry("desktop.update.download_failed", { status: "error", code: telemetryErrorCode(error), durationMs: Date.now() - startedAt });
      }
    } finally { this.abortController = null; }
  }

  cancel() { this.abortController?.abort(); }

  async install() {
    if (this.state?.status !== "ready") throw new Error("Desktop Runtime update is not ready.");
    this.reportTelemetry("desktop.update.install_started", { releaseId: this.state.releaseId });
    this.app.relaunch();
    this.app.exit(0);
    return true;
  }
}

function telemetryErrorCode(error) {
  if (typeof error?.telemetryCode === "string") return error.telemetryCode;
  if (typeof error?.code === "string" && /^E[A-Z0-9_]+$/u.test(error.code)) return "file_io";
  if (error instanceof TypeError) return "network";
  return "unknown";
}

module.exports = { DesktopUpdateController, telemetryErrorCode };
