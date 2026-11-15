const { session, WebContentsView } = require("electron");
const { DesktopBrowserTunnel } = require("./browser-tunnel.cjs");
const { PRODUCTION_ORIGIN } = require("./navigation-policy.cjs");

const PRODUCTION_HOSTNAME = new URL(PRODUCTION_ORIGIN).hostname;

class DesktopBrowserController {
  constructor(window, reportTelemetry = () => undefined) {
    this.window = window;
    this.tunnel = new DesktopBrowserTunnel(reportTelemetry);
    this.tabs = new Map();
    this.activeTabId = null;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.partition = null;
    this.browserSession = null;
    this.proxyCredentials = null;
    this.nextTabId = 1;
  }

  async show(input) {
    validateShowInput(input);
    const partition = `persist:fields-browser-${input.storagePartition}`;
    if (this.partition !== partition) await this.reset(partition);
    this.bounds = sanitizeBounds(input.bounds);
    const endpoint = await this.tunnel.start(input.tunnel);
    this.proxyCredentials = endpoint;
    await this.browserSession.setProxy({ mode: "fixed_servers", proxyRules: `http://${endpoint.host}:${endpoint.port}`, proxyBypassRules: "<-loopback>" });
    await this.browserSession.closeAllConnections();
    if (this.tabs.size === 0) this.createTab(input.initialUrl || "https://auth.openai.com/");
    else if (input.initialUrl) this.navigate(input.initialUrl);
    this.layout();
    this.emitState();
  }

  async reset(partition) {
    await this.hide();
    for (const tab of this.tabs.values()) tab.view.webContents.close();
    this.tabs.clear();
    this.activeTabId = null;
    this.partition = partition;
    this.browserSession = session.fromPartition(partition);
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.browserSession.setPermissionCheckHandler(() => false);
  }

  createTab(url = null, shouldLoad = true) {
    const id = this.nextTabId++;
    const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, session: this.browserSession } });
    this.window.contentView.addChildView(view);
    const tab = { id, view, title: "New tab", url: "", loading: false };
    this.tabs.set(id, tab);
    this.activeTabId = id;
    view.webContents.on("page-title-updated", (_event, title) => { tab.title = title; this.emitState(); });
    view.webContents.on("did-start-loading", () => { tab.loading = true; this.emitState(); });
    view.webContents.on("did-stop-loading", () => { tab.loading = false; tab.url = view.webContents.getURL(); this.emitState(); });
    view.webContents.on("did-navigate", (_event, nextUrl) => { tab.url = nextUrl; this.emitState(); });
    view.webContents.on("will-navigate", (event, nextUrl) => { if (!allowedUrl(nextUrl)) event.preventDefault(); });
    view.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
      if (!allowedUrl(nextUrl)) return { action: "deny" };
      return {
        action: "allow",
        createWindow: () => {
          const popupTabId = this.createTab(null, false);
          return this.tabs.get(popupTabId).view.webContents;
        },
      };
    });
    if (shouldLoad) {
      void view.webContents.loadURL(allowedUrl(url) ? url : "https://auth.openai.com/");
    }
    this.layout();
    return id;
  }

  selectTab(id) { if (this.tabs.has(id)) { this.activeTabId = id; this.layout(); this.emitState(); } }
  closeTab(id) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    this.tabs.delete(id);
    if (this.activeTabId === id) this.activeTabId = this.tabs.keys().next().value ?? null;
    this.layout();
    this.emitState();
  }
  navigate(url) { const tab = this.active(); if (tab && allowedUrl(url)) void tab.view.webContents.loadURL(url); }
  back() { const tab = this.active(); if (tab?.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack(); }
  forward() { const tab = this.active(); if (tab?.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward(); }
  reload() { this.active()?.view.webContents.reload(); }
  setBounds(bounds) { this.bounds = sanitizeBounds(bounds); this.layout(); }
  async clearData() { await this.browserSession?.clearStorageData(); }

  async hide() {
    for (const tab of this.tabs.values()) tab.view.setVisible(false);
    await this.tunnel.stop();
    this.proxyCredentials = null;
  }

  async dispose() {
    await this.hide();
    for (const tab of this.tabs.values()) tab.view.webContents.close();
    this.tabs.clear();
  }

  handlesProxyLogin(webContents, authInfo) {
    return Boolean(authInfo.isProxy && this.proxyCredentials && [...this.tabs.values()].some((tab) => tab.view.webContents === webContents));
  }
  credentials() { return this.proxyCredentials; }
  active() { return this.activeTabId === null ? null : this.tabs.get(this.activeTabId) ?? null; }
  layout() {
    for (const tab of this.tabs.values()) {
      const active = tab.id === this.activeTabId;
      tab.view.setBounds(this.bounds);
      tab.view.setVisible(active && this.bounds.width > 0 && this.bounds.height > 0);
    }
  }
  emitState() {
    if (this.window.isDestroyed()) return;
    const active = this.active();
    this.window.webContents.send("fields:browser:state", {
      activeTabId: this.activeTabId,
      canGoBack: active?.view.webContents.navigationHistory.canGoBack() ?? false,
      canGoForward: active?.view.webContents.navigationHistory.canGoForward() ?? false,
      tabs: [...this.tabs.values()].map((tab) => ({ id: tab.id, title: tab.title, url: tab.url, loading: tab.loading })),
    });
  }
}

function allowedUrl(value) { try { return new URL(value).protocol === "https:"; } catch { return false; } }
function validateShowInput(input) {
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(input?.storagePartition ?? "")) {
    throw new Error("Invalid Desktop browser partition.");
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(input?.tunnel?.token ?? "")
    || !/^[A-Za-z0-9_-]{16,128}$/u.test(input?.tunnel?.clientNonce ?? "")) {
    throw new Error("Invalid Desktop browser tunnel credentials.");
  }
  let tunnelUrl;
  try { tunnelUrl = new URL(input.tunnel.websocketUrl); } catch { throw new Error("Invalid Desktop browser tunnel URL."); }
  if (tunnelUrl.protocol !== "wss:"
    || tunnelUrl.hostname !== PRODUCTION_HOSTNAME
    || tunnelUrl.port
    || tunnelUrl.username
    || tunnelUrl.password
    || tunnelUrl.pathname !== "/api/v1/desktop-browser/tunnel"
    || tunnelUrl.search
    || tunnelUrl.hash) {
    throw new Error("Invalid Desktop browser tunnel URL.");
  }
}
function sanitizeBounds(value) {
  const number = (input) => Math.max(0, Math.round(Number(input) || 0));
  return { x: number(value?.x), y: number(value?.y), width: number(value?.width), height: number(value?.height) };
}

module.exports = { DesktopBrowserController, allowedUrl, sanitizeBounds, validateShowInput };
