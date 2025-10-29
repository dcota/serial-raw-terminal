import { app, BrowserWindow } from "electron";
import path from "node:path";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { Menu, shell } from "electron";
import { ipcMain, dialog } from "electron";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_URL = "http://127.0.0.1:5173/";
//const IO_PORT = 17865;

let win = null;
let serial = null;
let parser = null;
let isOpen = false;
let quitting = false;
//let confirming = false;

// Let renderer pull the current port any time
ipcMain.handle("sio:getPort", () => sioPort || null);

// --- Local Socket.IO server (serial lives here) ---

//const httpServer = http.createServer(ex);
//const io = new Server(httpServer, { cors: { origin: "*" } });

const isMac = process.platform === "darwin";
const isDev = process.env.VITE_DEV === "1" || !app.isPackaged;

// --- Socket.IO server (dynamic port, start once) ---
let sio = null;
let sioServer = null;
let sioPort = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }
});

// Close serial, saver, socket server — swallow errors and complete quickly
async function cleanup() {
  try {
    if (serial && isOpen) await new Promise((res) => serial.close(() => res()));
    isOpen = false;
  } catch {}
  try {
    saver?.stream?.end();
    saver.stream = null;
    saver.ended = true;
    saver.queue = [];
  } catch {}
  try {
    if (sioServer) await new Promise((res) => sioServer.close(() => res()));
  } catch {}
}

function wireWindowClose(win) {
  win.on("close", async (e) => {
    if (quitting) return;
    if (isOpen) {
      e.preventDefault();
      await dialog.showMessageBox(win, {
        type: "info",
        buttons: ["OK"],
        title: "Ligação ativa",
        message: "Desligue a ligação antes de fechar a aplicação.",
      });
      return;
    }
    // disconnected: tidy up and allow close
    await cleanup();
  });
}

function ensureSocketServer(win) {
  if (sio && sioPort) {
    // if already started, just re-announce the port to the renderer
    try {
      win?.webContents.send("sio:port", sioPort);
    } catch {}
    return;
  }
  const ex = express();
  sioServer = http.createServer(ex); // reuse your express app `ex`
  sio = new Server(sioServer, { cors: { origin: "*" } });

  sio.on("connection", (socket) => {
    socket.on("conn", async (payload) => {
      try {
        const portPath =
          payload && typeof payload === "object" ? payload.port : payload;
        const baudRate =
          payload && typeof payload === "object" && payload.baudRate
            ? Number(payload.baudRate)
            : 9600;

        if (!portPath) {
          socket.emit("errors", "Nenhuma porta selecionada");
          return;
        }

        if (serial && isOpen) {
          await new Promise((res) => serial.close(() => res()));
          isOpen = false;
        }

        serial = new SerialPort({ path: portPath, baudRate }, (err) => {
          if (err) {
            socket.emit(
              "errors",
              "Erro ao abrir porta: " + String(err.message || err)
            );
            return;
          }
          isOpen = true;
          socket.emit("data", `# conectado a ${portPath} @ ${baudRate} bps`);
          attachSerialListeners(socket);
        });
      } catch (e) {
        socket.emit("errors", "Erro na ligação: " + String(e?.message || e));
      }
    });

    socket.on("disconn", async () => {
      try {
        if (serial && isOpen) {
          await new Promise((res) => serial.close(() => res()));
          isOpen = false;
        }
        if (saver?.stream && !saver.ended) {
          try {
            saver.stream.end();
          } catch {}
          saver.stream = null;
          saver.ended = true;
          saver.queue = [];
          socket.emit("save:status", {
            active: false,
            paused: false,
            filepath: saver.filepath,
            queued: 0,
          });
        }
        socket.emit("data", "# desligado");
      } catch (e) {
        socket.emit("errors", "Erro ao desligar: " + String(e?.message || e));
      }
    });

    socket.on("getcoms", async () => {
      const list = await SerialPort.list();
      socket.emit(
        "coms",
        list.map((d) => d.path)
      );
    });
  });

  sioServer.on("error", (err) => {
    console.error("[socket] server error:", err?.code || err);
    // don't throw; app should still render
  });

  // listen on 0 -> OS picks a free port
  sioServer.listen(0, "127.0.0.1", () => {
    const addr = sioServer.address();
    sioPort = addr && typeof addr === "object" ? addr.port : null;
    console.log("[socket] listening on 127.0.0.1:", sioPort);
    try {
      win?.webContents.send("sio:port", sioPort);
    } catch {}
  });

  // IPC handlers
  ipcMain.handle("app:info", () => {
    return {
      name: app.getName(),
      version: app.getVersion(),
    };
  });

  ipcMain.handle("app:quit", async () => {
    quitting = true;
    await cleanup();
    app.quit();
  });

  ipcMain.handle("save:start", async (e) => {
    const win = BrowserWindow.getFocusedWindow();
    const confirm = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["Cancelar", "Confirmar"],
      defaultId: 1,
      cancelId: 0,
      title: "Guardar registo",
      message: "Iniciar gravação do log?",
      detail: "Cada linha recebida será anexada ao ficheiro.",
    });
    if (confirm.response !== 1) return { started: false };

    const ret = await dialog.showSaveDialog(win, {
      title: "Escolher ficheiro TXT",
      defaultPath: path.join(app.getPath("documents"), "log.txt"),
      filters: [{ name: "Texto", extensions: ["txt", "log"] }],
    });
    if (ret.canceled || !ret.filePath) return { started: false };

    try {
      if (saver.stream) saver.stream.end();
    } catch {}
    saver.stream = fs.createWriteStream(ret.filePath, { flags: "a" });
    saver.filepath = ret.filePath;
    saver.paused = false;
    saver.queue = [];
    saver.writing = false;
    saver.ended = false;

    saver.stream.on("error", () => sendStatus(e.sender));
    saver.stream.on("close", () => {
      saver.ended = true;
      sendStatus(e.sender);
    });

    sendStatus(e.sender);
    return { started: true, filepath: saver.filepath };
  });

  ipcMain.handle("save:startPath", async (e, filepath) => {
    if (!filepath) return { started: false };
    try {
      if (saver.stream) saver.stream.end();
    } catch {}
    saver.stream = fs.createWriteStream(filepath, { flags: "a" });
    saver.filepath = filepath;
    saver.paused = false;
    saver.queue = [];
    saver.writing = false;
    saver.ended = false;
    saver.stream.on("error", () => sendStatus(e.sender));
    saver.stream.on("close", () => {
      saver.ended = true;
      sendStatus(e.sender);
    });
    sendStatus(e.sender);
    return { started: true, filepath };
  });

  ipcMain.handle("save:append", (e, line) => {
    if (!saver.stream || saver.ended) return { active: false, queued: 0 };
    saver.queue.push(line.endsWith("\n") ? line : line + "\n");
    drain(e.sender);
    return { active: true, queued: saver.queue.length };
  });

  ipcMain.handle("save:pause", (e) => {
    saver.paused = true;
    sendStatus(e.sender);
    return { paused: true };
  });

  ipcMain.handle("save:resume", (e) => {
    saver.paused = false;
    drain(e.sender);
    sendStatus(e.sender);
    return { paused: false };
  });

  ipcMain.handle("save:stop", (e) => {
    try {
      saver.stream?.end();
    } catch {}
    saver.stream = null;
    saver.ended = true;
    saver.queue = [];
    sendStatus(e.sender);
    return { stopped: true };
  });

  ipcMain.handle("save:status", (e) => {
    sendStatus(e.sender);
    return { ok: true };
  });
}

// ---- Line-by-line saver (one active session) ----
const saver = {
  stream: null,
  filepath: "",
  paused: false,
  queue: [],
  writing: false,
  ended: false,
};

function sendStatus(winOrSender) {
  const sendFn = (ch, p) => {
    try {
      (winOrSender?.webContents || winOrSender)?.send(ch, p);
    } catch {}
  };
  sendFn("save:status", {
    active: !!saver.stream && !saver.ended,
    paused: saver.paused,
    filepath: saver.filepath,
    queued: saver.queue.length,
  });
}

function drain(winOrSender) {
  if (!saver.stream || saver.paused || saver.writing || saver.ended) return;
  const chunk = saver.queue.shift();
  if (chunk == null) return;
  saver.writing = true;
  const ok = saver.stream.write(chunk, "utf8", (err) => {
    saver.writing = false;
    if (err) {
      sendStatus(winOrSender);
      return;
    }
    if (!saver.paused && saver.queue.length) drain(winOrSender);
    else sendStatus(winOrSender);
  });
  if (!ok) {
    saver.stream.once("drain", () => {
      saver.writing = false;
      drain(winOrSender);
    });
  }
}

/*async function listPorts() {
  const ports = await SerialPort.list();
  return ports.map((p) => p.path);
}*/

function attachSerialListeners(socket) {
  if (parser) {
    try {
      parser.removeAllListeners();
    } catch {}
  }
  parser = serial.pipe(new ReadlineParser({ delimiter: "\n" }));
  parser.on("data", (line) => socket.emit("data", line.toString()));
  serial.on("error", (e) => socket.emit("porterror", String(e?.message || e)));
  serial.on("close", () => {
    isOpen = false;
    // ⛔ stop saving if active
    if (saver?.stream && !saver.ended) {
      try {
        saver.stream.end();
      } catch {}
      saver.stream = null;
      saver.ended = true;
      saver.queue = [];
      socket.emit("save:status", {
        active: false,
        paused: false,
        filepath: saver.filepath,
        queued: 0,
      });
    }
    socket.emit("data", "# porta fechada");
  });
}

/*async function requestSafeClose(win) {
  // If nothing is active, allow immediate close
  const serialActive = !!isOpen;
  const savingActive = !!(
    typeof saver !== "undefined" &&
    saver.stream &&
    !saver.ended
  );

  if (!serialActive && !savingActive) return true;

  const parts = [];
  if (serialActive) parts.push("ligação série ativa");
  if (savingActive) parts.push("gravação em curso");

  const detail = `Existe ${parts.join(" e ")}. Pretende sair?`;
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Cancelar", "Desligar/Terminar e Sair", "Forçar Saída"],
    defaultId: 0,
    cancelId: 0,
    title: "Sair da aplicação",
    message: "Operação em curso",
    detail,
  });

  if (response === 0) return false; // Cancel

  if (response === 1) {
    // Graceful: close serial and stop saving first
    try {
      if (serialActive && serial) {
        await new Promise((resolve) => serial.close(() => resolve()));
      }
      if (savingActive && saver?.stream && !saver.ended) {
        try {
          saver.stream.end();
        } catch {}
        saver.ended = true;
      }
    } catch (e) {
      // ignore cleanup errors; still allow quit
    }
    return true;
  }

  // response === 2 → Forçar Saída
  return true;
}*/

/*create menu template */
const template = [
  // App menu (macOS)
  ...(isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
      ]
    : []),

  // File
  {
    label: "Opções",
    submenu: [{ label: "Sair", role: isMac ? "close" : "quit" }],
  },

  // View
  {
    label: "Ver",
    submenu: [
      { label: "Tamanho inicial", role: "resetZoom" },
      { label: "Zoom +", role: "zoomIn" },
      { label: "Zoom -", role: "zoomOut" },
      { type: "separator" },
      { label: "Écran cheio", role: "togglefullscreen" },
    ],
  },
];

/*create menu */
const menu = Menu.buildFromTemplate(template);

Menu.setApplicationMenu(menu);

/*---- create Electron window ----*/
async function createWindow() {
  //await new Promise((r) => httpServer.listen(IO_PORT, "127.0.0.1", () => r()));
  win = new BrowserWindow({
    width: 1200,
    height: 740,
    minWidth: 1200,
    minHeight: 740,
    title: "CANSAT TERMINAL 2025",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  //wireWindowClose(win);

  win.on("close", async (e) => {
    if (quitting) return; // already quitting, allow close

    if (isOpen) {
      e.preventDefault();
      await dialog.showMessageBox(win, {
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "Ligação ativa",
        message: "Desligue a ligação antes de fechar a aplicação.",
      });
      return;
    }

    // Not connected: do a quick cleanup just in case, then allow close.
    // (No preventDefault, so the window will close.)
    await cleanup();
  });

  ensureSocketServer(win);

  // Try Vite dev server; if it fails, load the built file.
  if (isDev) {
    await win.loadURL(DEV_URL);
    //win.webContents.openDevTools({ mode: "detach" });
    console.log("[electron] Loaded DEV URL", DEV_URL);
  } else {
    const indexHtml = path.join(
      __dirname,
      "..",
      "renderer",
      "dist",
      "index.html"
    );
    await win.loadFile(indexHtml);
    console.log("[electron] Loaded FILE", indexHtml);
  }
  win.webContents.on("did-finish-load", () => {
    if (sioPort) win.webContents.send("sio:port", sioPort);
  });
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", async (e) => {
  e.preventDefault();
  await cleanup();
  app.exit(0); // hard-exit after cleanup to avoid hanging
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
