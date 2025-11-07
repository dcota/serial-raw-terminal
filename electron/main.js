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
import { Transform } from "node:stream";

class NormalizeNewlines extends Transform {
  _transform(chunk, enc, cb) {
    const out = chunk
      .toString("utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    this.push(Buffer.from(out, "utf8"));
    cb();
  }
}

class IdleLine extends Transform {
  constructor(timeoutMs = 100) {
    super();
    this.buf = "";
    this.timeoutMs = timeoutMs;
    this.timer = null;
  }
  _bumpTimer() {
    if (this.timer) clearTimeout(this.timer);
    if (this.buf.length === 0) return;
    this.timer = setTimeout(() => {
      if (this.buf.length) {
        this.push(this.buf);
        this.buf = "";
      }
      this.timer = null;
    }, this.timeoutMs);
  }
  _transform(chunk, enc, cb) {
    this.buf += chunk.toString("utf8");
    // emit full lines first
    const parts = this.buf.split("\n");
    this.buf = parts.pop(); // remainder (no trailing \n)
    for (const p of parts) this.push(p);
    // if remainder exists, arm idle flush
    this._bumpTimer();
    cb();
  }
  _flush(cb) {
    if (this.timer) clearTimeout(this.timer);
    if (this.buf.length) this.push(this.buf);
    this.buf = "";
    cb();
  }
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

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

let _lineBuf = "";
let _idleT = null;

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
        const isObj = payload && typeof payload === "object";
        const portPath = isObj ? payload.port : payload;
        const baudRate =
          isObj && payload.baudRate ? Number(payload.baudRate) : 9600;

        if (!portPath) {
          socket.emit("errors", "Nenhuma porta selecionada");
          return;
        }

        if (serial && isOpen) {
          await new Promise((res) => serial.close(() => res()));
          isOpen = false;
        }

        // Allow optional overrides but use safe defaults (8N1, no flow control)
        const portOpts = {
          path: portPath,
          baudRate,
          dataBits: Number(
            isObj && payload.dataBits != null ? payload.dataBits : 8
          ),
          stopBits: Number(
            isObj && payload.stopBits != null ? payload.stopBits : 1
          ),
          parity: isObj && payload.parity ? String(payload.parity) : "none",
          rtscts: !!(isObj && payload.rtscts), // default off
          xon: !!(isObj && payload.xon), // default off
          xoff: !!(isObj && payload.xoff), // default off
          xany: !!(isObj && payload.xany), // default off
        };

        serial = new SerialPort(
          {
            path: portPath,
            baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: "none",
            rtscts: false, // no HW flow control
            xon: false, // no SW flow control
            xoff: false,
            xany: false,
          },
          (err) => {
            if (err) {
              socket.emit(
                "errors",
                "Erro ao abrir porta: " + String(err.message || err)
              );
              return;
            }
            isOpen = true;

            // >>> KEY FIX: mimic the Python test that worked
            try {
              serial.set({ dtr: false, rts: false });
            } catch {}

            socket.emit("data", `# conectado a ${portPath} @ ${baudRate} bps`);
            attachSerialListeners(socket);
          }
        );
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

  ipcMain.handle("beep:play", () => {
    const wins = BrowserWindow.getAllWindows();
    for (const w of wins) {
      try {
        w.webContents.send("beep:html5");
      } catch {}
    }
    return true;
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
  if (!serial) return;

  try {
    if (parser) {
      try {
        parser.removeAllListeners();
      } catch {}
      try {
        serial.unpipe?.(parser);
      } catch {}
      parser = null;
    }
    serial.removeAllListeners("data");
    serial.removeAllListeners("error");
    serial.removeAllListeners("close");
  } catch {}

  const IDLE_MS = 150;

  const flushIdle = () => {
    if (_idleT) clearTimeout(_idleT);
    if (_lineBuf.length === 0) return; // nothing to flush
    _idleT = setTimeout(() => {
      const out = _lineBuf.trimEnd(); // drop trailing \n/\r and spaces
      if (out.length) socket.emit("data", out);
      _lineBuf = "";
      _idleT = null;
    }, IDLE_MS);
  };

  serial.on("data", (buf) => {
    const s = buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    _lineBuf += s;

    const parts = _lineBuf.split("\n");
    _lineBuf = parts.pop() ?? "";

    for (const line of parts) {
      const out = line.trimEnd();
      if (out.length) socket.emit("data", out); // <-- skip empty
    }

    if (_lineBuf.length) flushIdle();
  });

  serial.on("error", (e) => socket.emit("porterror", String(e?.message || e)));

  serial.on("close", () => {
    isOpen = false;
    if (_idleT) {
      clearTimeout(_idleT);
      _idleT = null;
    }
    const out = _lineBuf.trimEnd();
    if (out.length) socket.emit("data", out);
    _lineBuf = "";

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
  win = new BrowserWindow({
    width: 1400,
    height: 740,
    minWidth: 1400,
    minHeight: 740,
    title: "CANSAT TERMINAL 2025",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.on("close", async (e) => {
    if (quitting) return;
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
  app.exit(0);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
