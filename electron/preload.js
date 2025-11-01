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

// announce the dynamic Socket.IO port from main → renderer
contextBridge.exposeInMainWorld("SIO", {
  onPort: (cb) => ipcRenderer.on("sio:port", (_e, port) => cb(port)),
  getPort: () => ipcRenderer.invoke("sio:getPort"),
});

contextBridge.exposeInMainWorld("AppControl", {
  quit: () => ipcRenderer.invoke("app:quit"),
});

contextBridge.exposeInMainWorld("Beep", {
 play: () => ipcRenderer.invoke("beep:play"),
  // NEW: main tells us "do HTML beep instead"
  onHtml5: (cb) => ipcRenderer.on("beep:html5", cb),
});
