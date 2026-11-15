const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fieldsDesktop", {
  runtime: {
    markHealthy: () => ipcRenderer.invoke("fields:runtime:healthy"),
  },
  telemetry: {
    authenticated: (active) => ipcRenderer.invoke("fields:telemetry:authenticated", active),
  },
  browser: {
    show: (input) => ipcRenderer.invoke("fields:browser:show", input),
    hide: () => ipcRenderer.invoke("fields:browser:hide"),
    setBounds: (bounds) => ipcRenderer.send("fields:browser:bounds", bounds),
    navigate: (url) => ipcRenderer.send("fields:browser:navigate", url),
    back: () => ipcRenderer.send("fields:browser:back"),
    forward: () => ipcRenderer.send("fields:browser:forward"),
    reload: () => ipcRenderer.send("fields:browser:reload"),
    newTab: (url) => ipcRenderer.send("fields:browser:new-tab", url),
    selectTab: (id) => ipcRenderer.send("fields:browser:select-tab", id),
    closeTab: (id) => ipcRenderer.send("fields:browser:close-tab", id),
    clearData: () => ipcRenderer.invoke("fields:browser:clear-data"),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("fields:browser:state", listener);
      return () => ipcRenderer.removeListener("fields:browser:state", listener);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke("fields:settings:get"),
    update: (input) => ipcRenderer.invoke("fields:settings:update", input),
    onChanged: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("fields:settings:changed", listener);
      return () => ipcRenderer.removeListener("fields:settings:changed", listener);
    },
  },
  notifications: {
    show: (input) => ipcRenderer.invoke("fields:notification:show", input),
  },
  updates: {
    getState: () => ipcRenderer.invoke("fields:update:get-state"),
    download: () => ipcRenderer.invoke("fields:update:download"),
    cancel: () => ipcRenderer.invoke("fields:update:cancel"),
    install: () => ipcRenderer.invoke("fields:update:install"),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("fields:update:state", listener);
      return () => ipcRenderer.removeListener("fields:update:state", listener);
    },
  },
  navigation: {
    onOpen: (callback) => {
      const listener = (_event, destination) => callback(destination);
      ipcRenderer.on("fields:navigation", listener);
      return () => ipcRenderer.removeListener("fields:navigation", listener);
    },
  },
});
