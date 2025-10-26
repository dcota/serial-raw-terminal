const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("LogSaver", {
  start: () => ipcRenderer.invoke("save:start"),
  startPath: (p) => ipcRenderer.invoke("save:startPath", p),
  append: (line) => ipcRenderer.invoke("save:append", line),
  pause: () => ipcRenderer.invoke("save:pause"),
  resume: () => ipcRenderer.invoke("save:resume"),
  stop: () => ipcRenderer.invoke("save:stop"),
  status: () => ipcRenderer.invoke("save:status"),
  onStatus: (cb) => ipcRenderer.on("save:status", (_e, p) => cb(p)),
  onError: (cb) => ipcRenderer.on("save:error", (_e, m) => cb(m)),
});

contextBridge.exposeInMainWorld("AppInfo", {
  get: () => ipcRenderer.invoke("app:info"),
});
