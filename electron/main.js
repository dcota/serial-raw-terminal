import { app, BrowserWindow } from "electron";
import path from "node:path";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { Menu, shell } from "electron";

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

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

async function listPorts() {
  const ports = await SerialPort.list();
  return ports.map((p) => p.path);
}

io.on("connection", (socket) => {
  socket.on("getcoms", async () => {
    try {
      socket.emit("coms", await listPorts());
    } catch (e) {
      socket.emit("errors", String(e?.message || e));
    }
  });

  socket.on("conn", async (path) => {
    try {
      if (isOpen && serial) {
        try {
          await new Promise((r) => serial.close(() => r()));
        } catch {}
      }
      serial = new SerialPort({ path, baudRate: 9600 }, (err) => {
        if (err) socket.emit("porterror", String(err?.message || err));
      });
      parser = serial.pipe(new ReadlineParser({ delimiter: "\r\n" }));
      parser.on("data", (line) =>
        io.emit("data", line != null ? String(line) : "")
      );
      serial.on("error", (err) => socket.emit("porterror", String(err)));
      isOpen = true;
    } catch (e) {
      socket.emit("porterror", "Open failed: " + String(e?.message || e));
    }
  });

  socket.on("disconn", async () => {
    try {
      if (isOpen && serial) await new Promise((r) => serial.close(() => r()));
      serial = null;
      parser = null;
      isOpen = false;
    } catch (e) {
      socket.emit("porterror", "Close failed: " + String(e?.message || e));
    }
  });
});

async function createWindow() {
  // Start Socket.IO backend first
  await new Promise((r) => httpServer.listen(IO_PORT, "127.0.0.1", () => r()));

  win = new BrowserWindow({
    width: 1200,
    height: 740,
    webPreferences: {
      preload: path.join(process.cwd(), "electron/preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
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
