const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("LogSaver", {
  start: () => ipcRenderer.invoke("save:start"),
  append: (line) => ipcRenderer.invoke("save:append", line),
  pause: () => ipcRenderer.invoke("save:pause"),
  resume: () => ipcRenderer.invoke("save:resume"),
  stop: () => ipcRenderer.invoke("save:stop"),
  status: () => ipcRenderer.invoke("save:status"),
  onStatus: (cb) => ipcRenderer.on("save:status", (_e, payload) => cb(payload)),
  onError: (cb) => ipcRenderer.on("save:error", (_e, message) => cb(message)),
});

contextBridge.exposeInMainWorld("AppInfo", {
  get: () => ipcRenderer.invoke("app:info"),
});
