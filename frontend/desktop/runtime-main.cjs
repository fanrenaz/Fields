const path = require("node:path");

const { app, BrowserWindow, ipcMain, Menu, net, Notification, protocol, shell, Tray } = require("electron");

const { registerLocalContentProtocol } = require("./local-content.cjs");
const { PRODUCTION_ORIGIN, navigationAction } = require("./navigation-policy.cjs");
const { DesktopBrowserController } = require("./browser-controller.cjs");
const { DesktopSettingsStore } = require("./settings-store.cjs");
const {
  DesktopTelemetry,
  installDesktopClientHeaders,
  rendererExitCode,
} = require("./telemetry.cjs");

const productionUrl = `${PRODUCTION_ORIGIN}/`;
const windowsAppUserModelId = "com.fields.desktop";
const browserControllers = new Map();
let mainWindow = null;
let tray = null;
let settingsStore = null;
let isQuitting = false;
let pendingNavigation = null;
const notificationEventIds = new Set();
const desktopTelemetry = new DesktopTelemetry({
  version: app.getVersion(),
  fetch: (url, init) => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("Desktop session is unavailable.");
    return mainWindow.webContents.session.fetch(url, init);
  },
});
desktopTelemetry.record("desktop.app.starting");

function trustedDesktopEvent(event) {
  try {
    return new URL(event.senderFrame.url).origin === PRODUCTION_ORIGIN;
  } catch {
    return false;
  }
}

function browserController(event) {
  if (!trustedDesktopEvent(event)) throw new Error("Untrusted Desktop IPC sender.");
  const window = BrowserWindow.fromWebContents(event.sender);
  const controller = window ? browserControllers.get(window.id) : null;
  if (!controller) throw new Error("Desktop browser is unavailable.");
  return controller;
}

function registerBrowserIpc() {
  ipcMain.handle("fields:browser:show", (event, input) => browserController(event).show(input));
  ipcMain.handle("fields:browser:hide", (event) => browserController(event).hide());
  ipcMain.handle("fields:browser:clear-data", (event) => browserController(event).clearData());
  ipcMain.on("fields:browser:bounds", (event, input) => browserController(event).setBounds(input));
  ipcMain.on("fields:browser:navigate", (event, url) => browserController(event).navigate(url));
  ipcMain.on("fields:browser:back", (event) => browserController(event).back());
  ipcMain.on("fields:browser:forward", (event) => browserController(event).forward());
  ipcMain.on("fields:browser:reload", (event) => browserController(event).reload());
  ipcMain.on("fields:browser:new-tab", (event, url) => browserController(event).createTab(url));
  ipcMain.on("fields:browser:select-tab", (event, id) => browserController(event).selectTab(Number(id)));
  ipcMain.on("fields:browser:close-tab", (event, id) => browserController(event).closeTab(Number(id)));
}

function restoreWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (pendingNavigation) {
    mainWindow.webContents.send("fields:navigation", pendingNavigation);
    pendingNavigation = null;
  }
}

function applyLaunchAtLogin(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ["--hidden"] : [] });
}

function emitSettings(value) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("fields:settings:changed", value); }

function registerDesktopIpc() {
  ipcMain.handle("fields:telemetry:authenticated", (event, active) => {
    if (!trustedDesktopEvent(event) || typeof active !== "boolean") {
      throw new Error("Untrusted Desktop telemetry sender.");
    }
    desktopTelemetry.setAuthenticated(active);
  });
  ipcMain.handle("fields:settings:get", (event) => {
    if (!trustedDesktopEvent(event)) throw new Error("Untrusted Desktop IPC sender.");
    return settingsStore.get();
  });
  ipcMain.handle("fields:settings:update", async (event, input) => {
    if (!trustedDesktopEvent(event)) throw new Error("Untrusted Desktop IPC sender.");
    const value = await settingsStore.update(input);
    applyLaunchAtLogin(value.launchAtLogin);
    rebuildTrayMenu();
    emitSettings(value);
    return value;
  });
  ipcMain.handle("fields:notification:show", (event, input) => {
    if (!trustedDesktopEvent(event)) throw new Error("Untrusted Desktop IPC sender.");
    if (!settingsStore.get().notificationsEnabled || mainWindow?.isFocused()) return false;
    const notification = validatedNotification(input);
    if (!notification || notificationEventIds.has(notification.eventId)) return false;
    notificationEventIds.add(notification.eventId);
    if (notificationEventIds.size > 500) notificationEventIds.delete(notificationEventIds.values().next().value);
    const nativeNotification = new Notification({ title: notification.title, body: notification.body, icon: path.join(app.getAppPath(), "desktop", "assets", "fields.ico") });
    nativeNotification.on("click", () => {
      pendingNavigation = notification.destination;
      restoreWindow();
    });
    nativeNotification.show();
    return true;
  });
}

function validatedNotification(input) {
  if (!input || typeof input !== "object") return null;
  const eventId = typeof input.eventId === "string" ? input.eventId.slice(0, 256) : "";
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
  const body = typeof input.body === "string" ? input.body.trim().slice(0, 240) : "";
  const destination = input.destination;
  if (!eventId || !title || !body || !destination || typeof destination !== "object") return null;
  if (destination.kind === "room" && typeof destination.roomId === "string" && typeof destination.messageId === "string" && destination.roomId.trim() && destination.messageId.trim()) {
    return { eventId, title, body, destination: { kind: "room", roomId: destination.roomId.trim().slice(0, 256), messageId: destination.messageId.trim().slice(0, 256) } };
  }
  if (destination.kind === "home" && typeof destination.threadId === "string" && destination.threadId.trim()) {
    return { eventId, title, body, destination: { kind: "home", threadId: destination.threadId.trim().slice(0, 256) } };
  }
  return null;
}

function trayLabels() {
  const locale = app.getLocale().toLowerCase();
  if (locale.startsWith("zh-tw") || locale.startsWith("zh-hk")) return { open: "開啟 Fields", startup: "開機時啟動", notifications: "通知", quit: "退出" };
  if (locale.startsWith("zh")) return { open: "打开 Fields", startup: "开机时启动", notifications: "通知", quit: "退出" };
  return { open: "Open Fields", startup: "Launch at login", notifications: "Notifications", quit: "Quit" };
}

function rebuildTrayMenu() {
  if (!tray || !settingsStore) return;
  const labels = trayLabels();
  const settings = settingsStore.get();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: labels.open, click: restoreWindow },
    { type: "separator" },
    { label: labels.startup, type: "checkbox", checked: settings.launchAtLogin, click: (item) => void settingsStore.update({ launchAtLogin: item.checked }).then((value) => { applyLaunchAtLogin(value.launchAtLogin); rebuildTrayMenu(); emitSettings(value); }) },
    { label: labels.notifications, type: "checkbox", checked: settings.notificationsEnabled, click: (item) => void settingsStore.update({ notificationsEnabled: item.checked }).then((value) => { rebuildTrayMenu(); emitSettings(value); }) },
    { type: "separator" },
    { label: labels.quit, click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(path.join(app.getAppPath(), "desktop", "assets", "fields.ico"));
  tray.setToolTip("Fields");
  tray.on("double-click", restoreWindow);
  rebuildTrayMenu();
}

function openExternalHttps(url) {
  if (navigationAction(url) === "open-external") {
    void shell.openExternal(url);
  }
}

function protectNavigation(webContents) {
  const preventExternalNavigation = (event, url) => {
    if (navigationAction(url) !== "allow-in-app") {
      event.preventDefault();
      openExternalHttps(url);
    }
  };

  webContents.on("will-navigate", preventExternalNavigation);
  webContents.on("will-redirect", preventExternalNavigation);
  webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttps(url);
    return { action: "deny" };
  });
}

function createWindow({ hidden = false, preloadPath, runtimeRelease } = {}) {
  const window = new BrowserWindow({
    backgroundColor: "#FEFEFE",
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? {} : {
      titleBarOverlay: {
        color: "#FEFEFE",
        symbolColor: "#1B1813",
        height: 44,
      },
    }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow = window;

  installDesktopClientHeaders(window.webContents.session, {
    origin: PRODUCTION_ORIGIN,
    version: app.getVersion(),
    runtimeRelease: runtimeRelease.releaseId,
  });

  window.removeMenu();
  const browser = new DesktopBrowserController(window, (event, details) => desktopTelemetry.record(event, details));
  browserControllers.set(window.id, browser);
  window.on("closed", () => {
    browserControllers.delete(window.id);
    void browser.dispose();
    if (mainWindow === window) mainWindow = null;
  });
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });
  window.on("session-end", () => { isQuitting = true; });
  window.once("ready-to-show", () => { if (!hidden) restoreWindow(); });
  window.on("unresponsive", () => desktopTelemetry.record("desktop.renderer.unresponsive", { status: "error", code: "unknown" }));
  window.on("responsive", () => desktopTelemetry.record("desktop.renderer.recovered"));
  window.webContents.on("render-process-gone", (_event, details) => {
    desktopTelemetry.record("desktop.renderer.exited", { status: "error", code: rendererExitCode(details.reason) });
  });
  protectNavigation(window.webContents);
  void window.loadURL(productionUrl);
}

async function startDesktopRuntime({ runtimeRoot, rendererRoot, preloadPath, shellVersion, runtimeRelease, markHealthy }) {
  if (process.platform === "win32") app.setAppUserModelId(windowsAppUserModelId);
  app.on("second-instance", () => restoreWindow());
  app.on("before-quit", () => { isQuitting = true; });

  settingsStore = new DesktopSettingsStore(
    app.getPath("userData"),
    (event, details) => desktopTelemetry.record(event, details),
  );
  const settings = await settingsStore.load();
  applyLaunchAtLogin(settings.launchAtLogin);
  await registerLocalContentProtocol({
    protocol,
    net,
    webRoot: rendererRoot,
    version: shellVersion,
  });

  registerBrowserIpc();
  registerDesktopIpc();
  createTray();
  createWindow({ hidden: process.argv.includes("--hidden"), preloadPath, runtimeRelease });
  desktopTelemetry.record("desktop.app.ready");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ preloadPath, runtimeRelease });
    }
  });
  return {
    runtimeRoot,
    runtimeRelease,
    reportTelemetry: (event, details) => desktopTelemetry.record(event, details),
  };
}

module.exports = { startDesktopRuntime };

app.on("login", (event, webContents, _details, authInfo, callback) => {
  for (const controller of browserControllers.values()) {
    if (!controller.handlesProxyLogin(webContents, authInfo)) continue;
    const credentials = controller.credentials();
    event.preventDefault();
    callback(credentials.username, credentials.password);
    return;
  }
});

app.on("window-all-closed", () => undefined);
