const { app, BrowserWindow, dialog, ipcMain, net } = require("electron");
const path = require("node:path");

const { DesktopRuntimeStore } = require("./runtime-store.cjs");
const { RUNTIME_PUBLIC_KEYS } = require("./runtime-trust.cjs");
const { DesktopUpdateController } = require("./update-controller.cjs");

const PRODUCTION_ORIGIN = "https://fields.example.com";
// Keep the existing profile, sessions, and runtime cache across the brand change.
app.setPath("userData", path.join(app.getPath("appData"), "Fields"));
let activeRuntime = null;
let updateController = null;
let runtimeReporter = null;
const bufferedTelemetry = [];

function reportRuntimeTelemetry(event, details) {
  if (runtimeReporter) {
    runtimeReporter(event, details);
    return;
  }
  if (bufferedTelemetry.length < 64) bufferedTelemetry.push({ event, details });
}

function connectRuntimeTelemetry(reporter) {
  if (typeof reporter !== "function") return;
  runtimeReporter = reporter;
  for (const item of bufferedTelemetry.splice(0)) runtimeReporter(item.event, item.details);
}

function trustedDesktopEvent(event) {
  try {
    return new URL(event.senderFrame.url).origin === PRODUCTION_ORIGIN;
  } catch {
    return false;
  }
}

function registerBootstrapIpc(store) {
  ipcMain.handle("fields:runtime:healthy", async (event) => {
    if (!trustedDesktopEvent(event)) throw new Error("Untrusted Desktop IPC sender.");
    const releaseId = activeRuntime?.release?.releaseId;
    if (releaseId) await store.markHealthy(releaseId);
    return true;
  });
  ipcMain.handle("fields:update:get-state", (event) => {
    if (!trustedDesktopEvent(event)) throw new Error("Untrusted Desktop IPC sender.");
    return updateController?.getState() ?? null;
  });
  ipcMain.handle("fields:update:download", (event) => {
    if (!trustedDesktopEvent(event)) throw new Error("Untrusted Desktop IPC sender.");
    return updateController?.download();
  });
  ipcMain.handle("fields:update:cancel", (event) => {
    if (!trustedDesktopEvent(event)) throw new Error("Untrusted Desktop IPC sender.");
    updateController?.cancel();
    return true;
  });
  ipcMain.handle("fields:update:install", (event) => {
    if (!trustedDesktopEvent(event)) throw new Error("Untrusted Desktop IPC sender.");
    return updateController?.install();
  });
}

function loadRuntime(selection) {
  const entry = require(selection.mainPath);
  if (!entry || typeof entry.startDesktopRuntime !== "function") {
    throw new Error("Desktop Runtime entrypoint does not export startDesktopRuntime().");
  }
  return entry.startDesktopRuntime;
}

async function startSelectedRuntime(store, selection) {
  const startDesktopRuntime = loadRuntime(selection);
  activeRuntime = selection;
  return startDesktopRuntime({
    runtimeRoot: selection.runtimeRoot,
    rendererRoot: selection.rendererRoot,
    preloadPath: selection.preloadPath,
    shellVersion: app.getVersion(),
    runtimeRelease: selection.release,
    markHealthy: () => store.markHealthy(selection.release.releaseId),
  });
}

async function bootstrap() {
  await app.whenReady();
  const store = new DesktopRuntimeStore({
    userData: app.getPath("userData"),
    builtinRoot: app.getAppPath(),
    shellVersion: app.getVersion(),
    net,
    publicKeys: RUNTIME_PUBLIC_KEYS,
    reportTelemetry: reportRuntimeTelemetry,
  });
  await store.initialize();
  registerBootstrapIpc(store);

  const selection = await store.selectRuntime();
  try {
    const started = await startSelectedRuntime(store, selection);
    connectRuntimeTelemetry(started?.reportTelemetry);
  } catch {
    if (selection.release.releaseId) {
      await store.markFailed(selection.release.releaseId);
      app.relaunch();
      app.exit(1);
      return;
    } else {
      throw error;
    }
  }

  updateController = new DesktopUpdateController({
    app,
    store,
    windowProvider: () => BrowserWindow.getAllWindows()[0] ?? null,
    reportTelemetry: reportRuntimeTelemetry,
  });
  setTimeout(() => void updateController.check(), 5_000).unref?.();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void bootstrap().catch(() => {
    console.error("Desktop Bootstrap failed.");
    dialog.showErrorBox(
      "Fields could not start",
      "The installed application files are unavailable or damaged. Reinstall Fields and try again.",
    );
    app.quit();
  });
}

module.exports = { bootstrap, connectRuntimeTelemetry, loadRuntime, reportRuntimeTelemetry, startSelectedRuntime, trustedDesktopEvent };
