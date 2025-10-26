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

const DEV_URL = "http://127.0.0.1:5173/";
const IO_PORT = 17865;

let win = null;
let serial = null;
let parser = null;
let isOpen = false;

// --- Local Socket.IO server (serial lives here) ---
const ex = express();
const httpServer = http.createServer(ex);
const io = new Server(httpServer, { cors: { origin: "*" } });

// --- menubar ---

const isMac = process.platform === "darwin";
const isDev = !!process.env.VITE_DEV;

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

// ---- Line-by-line saver (one active session) ----
const saver = {
  stream: null,
  filepath: "",
  paused: false,
  queue: [],
  writing: false,
  ended: false,
};

function saverStatus(send) {
  send("save:status", {
    active: !!saver.stream && !saver.ended,
    paused: saver.paused,
    filepath: saver.filepath,
    queued: saver.queue.length,
  });
}

function drainQueue(send) {
  if (!saver.stream || saver.paused || saver.writing || saver.ended) return;
  const item = saver.queue.shift();
  if (item == null) return;
  saver.writing = true;
  const ok = saver.stream.write(item, "utf8", (err) => {
    saver.writing = false;
    if (err) {
      send("save:error", String(err.message || err));
      return;
    }
    if (!saver.paused && saver.queue.length) {
      drainQueue(send);
    } else {
      saverStatus(send);
    }
  });
  // if backpressure, wait for 'drain'
  if (!ok) {
    saver.stream.once("drain", () => {
      saver.writing = false;
      drainQueue(send);
    });
  }
}

// IPC handlers
ipcMain.handle("app:info", () => {
  return {
    name: app.getName(),
    version: app.getVersion(),
  };
});

ipcMain.handle("save:start", async (e) => {
  const win = BrowserWindow.getFocusedWindow();
  // Confirm intent
  const ok = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Cancelar", "Confirmar"],
    defaultId: 1,
    cancelId: 0,
    title: "Guardar registo",
    message: "Pretende iniciar a gravação do log em ficheiro de texto?",
    detail: "Cada linha recebida será gravada (modo de anexar).",
  });
  if (ok.response !== 1) return { started: false };

  // Choose file (new or existing) — APPEND if exists
  const ret = await dialog.showSaveDialog(win, {
    title: "Escolher ficheiro TXT",
    defaultPath: path.join(app.getPath("documents"), "log.txt"),
    filters: [{ name: "Texto", extensions: ["txt", "log"] }],
  });
  if (ret.canceled || !ret.filePath) return { started: false };

  // Close previous session (if any)
  try {
    if (saver.stream) saver.stream.end();
  } catch {}

  // Start fresh
  saver.stream = fs.createWriteStream(ret.filePath, { flags: "a" }); // append mode
  saver.filepath = ret.filePath;
  saver.paused = false;
  saver.queue = [];
  saver.writing = false;
  saver.ended = false;

  saver.stream.on("error", (err) => {
    e.sender.send("save:error", String(err.message || err));
  });
  saver.stream.on("close", () => {
    saver.ended = true;
    e.sender.send("save:status", {
      active: false,
      paused: false,
      filepath: saver.filepath,
      queued: 0,
    });
  });

  saverStatus(e.sender.send.bind(e.sender));
  return { started: true, filepath: saver.filepath };
});

ipcMain.handle("save:append", (e, line) => {
  if (!saver.stream || saver.ended) return { queued: 0, active: false };
  saver.queue.push(line.endsWith("\n") ? line : line + "\n");
  drainQueue(e.sender.send.bind(e.sender));
  return { queued: saver.queue.length, active: true };
});

ipcMain.handle("save:pause", (e) => {
  saver.paused = true;
  saverStatus(e.sender.send.bind(e.sender));
  return { paused: true };
});

ipcMain.handle("save:resume", (e) => {
  saver.paused = false;
  drainQueue(e.sender.send.bind(e.sender));
  saverStatus(e.sender.send.bind(e.sender));
  return { paused: false };
});

ipcMain.handle("save:stop", (e) => {
  if (saver.stream && !saver.ended) {
    try {
      saver.stream.end();
    } catch {}
  }
  saver.stream = null;
  saver.ended = true;
  saver.queue = [];
  saverStatus(e.sender.send.bind(e.sender));
  return { stopped: true };
});

ipcMain.handle("save:status", (e) => {
  saverStatus(e.sender.send.bind(e.sender));
  return { ok: true };
});

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

async function listPorts() {
  const ports = await SerialPort.list();
  return ports.map((p) => p.path);
}

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
    // stop saving if active
    if (typeof saver !== "undefined" && saver.stream && !saver.ended) {
      try {
        saver.stream.end();
      } catch {}
      saver.stream = null;
      saver.ended = true;
    }
    socket.emit("data", "# porta fechada");
  });
}

io.on("connection", (socket) => {
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
      // ⛔ also stop saving from main side
      if (typeof saver !== "undefined" && saver.stream && !saver.ended) {
        try {
          saver.stream.end();
        } catch {}
        saver.stream = null;
        saver.ended = true;
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

async function requestSafeClose(win) {
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
}

async function createWindow() {
  // Start Socket.IO backend first
  await new Promise((r) => httpServer.listen(IO_PORT, "127.0.0.1", () => r()));

  win = new BrowserWindow({
    width: 1200,
    height: 740,
    minWidth: 1200,
    minHeight: 740,
    title: "CANSAT TERMINAL 2025",
    webPreferences: {
      preload: path.join(process.cwd(), "electron/preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  let quitting = false;
  win.on("close", async (e) => {
    if (quitting) return; // already approved
    const ok = await requestSafeClose(win);
    if (!ok) {
      e.preventDefault();
      return;
    }
    quitting = true;
  });
  win.on("close", (e) => {
    if (isOpen) {
      e.preventDefault();
      dialog.showMessageBox(win, {
        type: "info",
        buttons: ["OK"],
        title: "Ligação ativa",
        message: "Desligue a ligação antes de fechar a aplicação.",
      });
    }
  });

  // Try Vite dev server; if it fails, load the built file.
  try {
    await win.loadURL(DEV_URL);
    //win.webContents.openDevTools({ mode: "detach" }); // separate window
  } catch (e) {
    const prodFile = path.join(process.cwd(), "renderer/dist/index.html");
    console.log("[electron] DEV URL not available; loading", prodFile);
    await win.loadFile(prodFile);
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", async (e) => {
  if (quitting) return;
  const win =
    BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win) return;
  const ok = await requestSafeClose(win);
  if (!ok) {
    e.preventDefault();
    return;
  }
  quitting = true;
});
