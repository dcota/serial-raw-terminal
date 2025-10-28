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
const IO_PORT = 17865;

let win = null;
let serial = null;
let parser = null;
let isOpen = false;

let quitting = false;
//let confirming = false;

// --- Local Socket.IO server (serial lives here) ---
const ex = express();
const httpServer = http.createServer(ex);
const io = new Server(httpServer, { cors: { origin: "*" } });

const isMac = process.platform === "darwin";
const isDev = process.env.VITE_DEV === "1" || !app.isPackaged;

// ---- Line-by-line saver (one active session) ----
const saver = {
  stream: null,
  filepath: "",
  paused: false,
  queue: [],
  writing: false,
  ended: false,
};

function sendStatus(send) {
  send("save:status", {
    active: !!saver.stream && !saver.ended,
    paused: saver.paused,
    filepath: saver.filepath,
    queued: saver.queue.length,
  });
}

function drain(send) {
  if (!saver.stream || saver.paused || saver.writing || saver.ended) return;
  const chunk = saver.queue.shift();
  if (chunk == null) return;
  saver.writing = true;
  const ok = saver.stream.write(chunk, "utf8", (err) => {
    saver.writing = false;
    if (err) {
      send("save:error", String(err.message || err));
      return;
    }
    if (!saver.paused && saver.queue.length) drain(send);
    else sendStatus(send);
  });
  if (!ok) {
    saver.stream.once("drain", () => {
      saver.writing = false;
      drain(send);
    });
  }
}

/*function saverStatus(send) {
  send("save:status", {
    active: !!saver.stream && !saver.ended,
    paused: saver.paused,
    filepath: saver.filepath,
    queued: saver.queue.length,
  });
}*/

/*function drainQueue(send) {
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
}*/

// IPC handlers
ipcMain.handle("app:info", () => {
  return {
    name: app.getName(),
    version: app.getVersion(),
  };
});

ipcMain.handle("save:start", async (e) => {
  const win = BrowserWindow.getFocusedWindow();
  const ok = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Cancelar", "Confirmar"],
    defaultId: 1,
    cancelId: 0,
    title: "Guardar registo",
    message: "Iniciar gravação do log?",
    detail: "Cada linha recebida será anexada ao ficheiro.",
  });
  if (ok.response !== 1) return { started: false };

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

  saver.stream.on("error", (err) =>
    e.sender.send("save:error", String(err.message || err))
  );
  saver.stream.on("close", () => {
    saver.ended = true;
    e.sender.send("save:status", {
      active: false,
      paused: false,
      filepath: saver.filepath,
      queued: 0,
    });
  });

  sendStatus(e.sender.send.bind(e.sender));
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
  saver.stream.on("error", (err) =>
    e.sender.send("save:error", String(err.message || err))
  );
  saver.stream.on("close", () => {
    saver.ended = true;
    e.sender.send("save:status", {
      active: false,
      paused: false,
      filepath,
      queued: 0,
    });
  });
  sendStatus(e.sender.send.bind(e.sender));
  return { started: true, filepath };
});

ipcMain.handle("save:append", (e, line) => {
  if (!saver.stream || saver.ended) return { active: false, queued: 0 };
  saver.queue.push(line.endsWith("\n") ? line : line + "\n");
  drain(e.sender.send.bind(e.sender));
  return { active: true, queued: saver.queue.length };
});

ipcMain.handle("save:pause", (e) => {
  saver.paused = true;
  sendStatus(e.sender.send.bind(e.sender));
  return { paused: true };
});

ipcMain.handle("save:resume", (e) => {
  saver.paused = false;
  drain(e.sender.send.bind(e.sender));
  sendStatus(e.sender.send.bind(e.sender));
  return { paused: false };
});

ipcMain.handle("save:stop", (e) => {
  try {
    if (saver.stream && !saver.ended) saver.stream.end();
  } catch {}
  saver.stream = null;
  saver.ended = true;
  saver.queue = [];
  sendStatus(e.sender.send.bind(e.sender));
  return { stopped: true };
});

ipcMain.handle("save:status", (e) => {
  sendStatus(e.sender.send.bind(e.sender));
  return { ok: true };
});

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
      // ⛔ stop saving from main side too (belt & suspenders)
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
  await new Promise((r) => httpServer.listen(IO_PORT, "127.0.0.1", () => r()));
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
  if (isDev) {
    await win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
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
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", (e) => {
  if (quitting) return; // already approved
  e.preventDefault();
  // Trigger the window close path (which shows the dialog once)
  const w =
    BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (w) w.close(); // will hit the handler above
});
