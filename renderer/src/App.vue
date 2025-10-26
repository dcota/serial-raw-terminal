<template>
  <div class="d-flex flex-column vh-100">
    <!-- Top title row -->
    <div class="container mt-3">
      <div class="d-flex align-items-center justify-content-between">
        <h1 class="ms-1 mb-2">CanSat Terminal</h1>
        <!-- you can put an icon at right if you want -->
      </div>
    </div>

    <!-- Controls row -->
    <div class="container mb-2">
      <div class="row g-2 ms-1 align-items-end">
        <!-- LEFT: get ports -->
        <div class="col-auto">
          <button
            class="btn btn-sm btn-primary btn-icon"
            @click="getPorts"
            :disabled="busy || connected"
            data-bs-title="Obter portas"
            data-bs-toggle="tooltip"
            data-bs-trigger="hover"
          >
            <i class="bi bi-usb-symbol"></i>
            <span class="visually-hidden">Obter portas</span>
          </button>
        </div>

        <!-- Port select -->
        <div class="col-auto">
          <select
            class="form-select form-select-sm text-center"
            v-model="selectedPort"
            style="min-width: 220px"
            data-bs-title="Selecione uma porta"
            data-bs-toggle="tooltip"
            data-bs-trigger="hover"
          >
            <option v-for="p in ports" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>

        <!-- Baud select -->
        <div class="col-auto">
          <select
            class="form-select form-select-sm text-center"
            v-model="selectedBaud"
            style="min-width: 140px"
            data-bs-title="Baud rate"
            data-bs-toggle="tooltip"
            data-bs-trigger="hover"
          >
            <option v-for="b in baudRates" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>
        <!-- Connect / Disconnect (single persistent button) -->
        <div class="col-auto">
          <span
            class="d-inline-block"
            :tabindex="!connected && !selectedPort ? '0' : null"
          >
            <button
              class="btn btn-sm btn-icon"
              :class="connected ? 'btn-danger' : 'btn-success'"
              @click="connected ? disconnect() : connect()"
              :disabled="!selectedPort && !connected"
              v-bstooltip="connected ? 'Desligar' : 'Ligar'"
              aria-label="Conectar/Desligar"
            >
              <i :class="connected ? 'bi bi-x-circle' : 'bi bi-plug'"></i>
              <span class="visually-hidden">{{
                connected ? "Desligar" : "Ligar"
              }}</span>
            </button>
          </span>
        </div>

        <!-- RIGHT: Save controls (icon-only) -->
        <div class="col ms-auto text-end">
          <div class="d-inline-flex gap-2">
            <!-- Guardar -->
            <button
              class="btn btn-sm btn-outline-primary btn-icon"
              @click="startSaving"
              :disabled="saving"
              data-bs-title="Guardar"
              data-bs-toggle="tooltip"
              data-bs-trigger="hover"
            >
              <i class="bi bi-floppy"></i>
              <span class="visually-hidden">Guardar</span>
            </button>

            <!-- Pausar -->
            <button
              class="btn btn-sm btn-outline-warning btn-icon"
              v-if="saving && !savingPaused"
              @click="pauseSaving"
              data-bs-title="Pausar"
              data-bs-toggle="tooltip"
              data-bs-trigger="hover"
            >
              <i class="bi bi-pause-circle"></i>
              <span class="visually-hidden">Pausar</span>
            </button>

            <!-- Retomar -->
            <button
              class="btn btn-sm btn-outline-success btn-icon"
              v-if="saving && savingPaused"
              @click="resumeSaving"
              data-bs-title="Retomar"
              data-bs-toggle="tooltip"
              data-bs-trigger="hover"
            >
              <i class="bi bi-play-circle"></i>
              <span class="visually-hidden">Retomar</span>
            </button>

            <!-- Terminar -->
            <button
              class="btn btn-sm btn-outline-danger btn-icon"
              v-if="saving"
              @click="stopSaving"
              data-bs-title="Terminar"
              data-bs-toggle="tooltip"
              data-bs-trigger="hover"
            >
              <i class="bi bi-stop-circle"></i>
              <span class="visually-hidden">Terminar</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Log area fills ALL remaining height from the start -->
    <div class="container flex-grow-1 d-flex min-h-0 mt-2 mb-3">
      <!-- Single card (outer frame only) -->
      <div class="card flex-grow-1 d-flex min-h-0">
        <!-- Header with centered controls -->
        <div class="card-header d-flex align-items-center">
          <!-- Middle: controls, centered -->
          <div
            class="flex-grow-1 d-flex justify-content-left align-items-center flex-wrap gap-3"
          >
            <!-- Nº linha / Tempo / Data / Todos -->
            <div class="d-flex align-items-center gap-3">
              <div
                class="form-check form-check-inline m-0 d-flex align-items-center"
              >
                <input
                  class="form-check-input mt-0"
                  type="checkbox"
                  id="optLn"
                  v-model="showLineNo"
                  :disabled="includeAll"
                />
                <label class="form-check-label ms-1 mb-0" for="optLn"
                  >Nº linha</label
                >
              </div>

              <div
                class="form-check form-check-inline m-0 d-flex align-items-center"
              >
                <input
                  class="form-check-input mt-0"
                  type="checkbox"
                  id="optTime"
                  v-model="showTime"
                  :disabled="includeAll"
                />
                <label class="form-check-label ms-1 mb-0" for="optTime"
                  >Tempo</label
                >
              </div>

              <div
                class="form-check form-check-inline m-0 d-flex align-items-center"
              >
                <input
                  class="form-check-input mt-0"
                  type="checkbox"
                  id="optDate"
                  v-model="showDate"
                  :disabled="includeAll"
                />
                <label class="form-check-label ms-1 mb-0" for="optDate"
                  >Data</label
                >
              </div>

              <div
                class="form-check form-check-inline m-0 d-flex align-items-center"
              >
                <input
                  class="form-check-input mt-0"
                  type="checkbox"
                  id="optAll"
                  v-model="includeAll"
                />
                <label class="form-check-label ms-1 mb-0 me-4" for="optAll"
                  >Todos</label
                >
              </div>
            </div>
            <div class="d-flex align-items-center ms-2">
              <button
                class="btn btn-sm btn-outline-secondary btn-icon"
                @click="decFont"
                v-bstooltip="'Diminuir texto'"
                aria-label="Diminuir texto"
              >
                <i class="bi bi-dash-lg"></i>
              </button>
              <span class="mx-2 small">{{ fontSize }}px</span>
              <button
                class="btn btn-sm btn-outline-secondary btn-icon"
                @click="incFont"
                v-bstooltip="'Aumentar texto'"
                aria-label="Aumentar texto"
              >
                <i class="bi bi-plus-lg"></i>
              </button>
            </div>
            <!-- Text color picker (used in dark mode only) -->
            <div class="d-flex align-items-center">
              <label for="logColor" class="me-2">Cor do texto</label>
              <input
                id="logColor"
                type="color"
                v-model="logColor"
                :disabled="!logDark"
                style="
                  width: 32px;
                  height: 24px;
                  padding: 0;
                  border: 0;
                  background: none;
                "
              />
            </div>

            <!-- Dark/Light -->
            <div class="form-check form-switch m-0">
              <input
                class="form-check-input"
                type="checkbox"
                id="logBgSwitch"
                v-model="logDark"
              />
              <label class="form-check-label" for="logBgSwitch">{{
                logDark ? "Escuro" : "Claro"
              }}</label>
            </div>
          </div>

          <!-- Right: connection/status -->
          <span class="small text-muted ms-auto">{{ status }}</span>
        </div>

        <!-- Body: scrollable log fills height -->
        <div class="card-body p-0 d-flex flex-column min-h-0">
          <div
            ref="rawlog"
            class="flex-grow-1 overflow-auto font-monospace"
            :style="{
              backgroundColor: logBg,
              color: logFg,
              padding: '8px 10px 6px 10px',
              fontSize: fontSize + 'px',
              lineHeight: 1.35,
            }"
          >
            <div v-for="(line, i) in log" :key="i">{{ line }}</div>
            <div ref="bottomSentinel" style="height: 1px"></div>
          </div>

          <!-- Footer row inside card: status left, clear right -->
          <div
            class="d-flex justify-content-between align-items-center p-2 pt-1 border-top"
          >
            <div
              class="small text-muted text-truncate me-3"
              style="max-width: 60%"
            >
              {{ savingPath ? savingMsg + " • " + savingPath : savingMsg }}
            </div>
            <button
              class="btn btn-sm btn-outline-secondary btn-icon"
              @click="clearLog"
              data-bs-title="Limpar log"
              data-bs-toggle="tooltip"
              data-bs-trigger="hover"
              data-bs-placement="bottom"
            >
              <i class="bi bi-eraser"></i>
              <span class="visually-hidden">Limpar</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- App footer -->
    <div class="container mt-auto py-2 border-top small text-muted">
      <div
        class="d-flex align-items-center justify-content-between flex-wrap gap-2"
      >
        <div class="d-flex align-items-center gap-2">
          <img
            src="./assets/cansat_logo.png"
            alt=""
            style="width: 60px; height: 60px"
          />
          <span>{{ "CanSat Terminal" }}</span>
        </div>
        <div class="text-nowrap">v{{ appInfo.version || "dev" }}</div>
        <div class="text-nowrap">&copy; {{ year }} {{ author }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from "vue";
import { io } from "socket.io-client";
import * as bootstrap from "bootstrap";
import { getCurrentInstance } from "vue";

// Bootstrap Tooltip directive (local to this component)
const bsTooltip = {
  mounted(el, binding) {
    if (el.hasAttribute("title")) el.removeAttribute("title"); // avoid native tooltip
    el.__tip = new bootstrap.Tooltip(el, {
      title: binding.value,
      trigger: "hover",
      container: "body", // <- render outside component tree
      boundary: "window", // reduce reflow jitter
      delay: { show: 100, hide: 100 },
    });
    el.__tipText = binding.value;
  },
  updated(el, binding) {
    // Only touch the tooltip if the text actually changed
    if (binding.value === binding.oldValue) return;
    const tip = el.__tip;
    if (!tip) return;
    el.__tipText = binding.value;
    if (typeof tip.setContent === "function") {
      tip.setContent({ ".tooltip-inner": binding.value });
    } else {
      // fallback for older Bootstrap
      tip.dispose();
      el.__tip = new bootstrap.Tooltip(el, {
        title: binding.value,
        trigger: "hover",
        container: "body",
        boundary: "window",
        delay: { show: 100, hide: 100 },
      });
    }
  },
  beforeUnmount(el) {
    try {
      el.__tip?.dispose();
    } catch {}
    delete el.__tip;
  },
};

// register locally
getCurrentInstance()?.appContext.app?.directive("bstooltip", bsTooltip);

let tooltipInstances = [];
const connBtn = ref(null);

// ---------- socket ----------
const socket = io("http://127.0.0.1:17865");

// ---------- state ----------
const ports = ref([]);
const selectedPort = ref("");
const busy = ref(false);
const connected = ref(false);
const status = ref("Desligado");

// baud
const baudRates = [
  "2400",
  "4800",
  "9600",
  "19200",
  "28800",
  "38400",
  "56600",
  "57600",
  "76800",
  "115200",
];
const selectedBaud = ref("9600");

// log + scroll
const log = ref([]);
const rawlogEl = ref(null);
const bottomSentinel = ref(null);

// prefix toggles
const showLineNo = ref(false);
const showTime = ref(false);
const showDate = ref(false);
const includeAll = ref(false);
const lineNo = ref(1);
const skipNext = ref(true); // skip first line after (re)connect

// theme
const logDark = ref(true);
const logColor = ref("#00ff66");
const logBg = computed(() => (logDark.value ? "#000" : "#fff"));
const logFg = computed(() => (logDark.value ? logColor.value : "#000"));

// saving
const saving = ref(false);
const savingPaused = ref(false);
const savingPath = ref("");
const savingQueued = ref(0);
const savingMsg = ref("Inativo");

// footer app info
const appInfo = ref({ name: "CanSat Terminal", version: "" });
const author = "Duarte Cota";
const year = new Date().getFullYear();

const lastSavePath = ref(""); // remember last used file
const autoResumeSaving = ref(true); // choose default behavior

const fontSize = ref(14);
const DEFAULT_FONT = 14;

// ---------- helpers ----------
function handleWheelZoom(e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (shouldIgnoreHotkeyTarget(e.target)) return;
  e.preventDefault();
  if (e.deltaY < 0) incFont();
  else if (e.deltaY > 0) decFont();
}

function shouldIgnoreHotkeyTarget(target) {
  if (!target) return false;
  const tag = (target.tagName || "").toLowerCase();
  const editable = target.isContentEditable;
  return editable || tag === "input" || tag === "textarea" || tag === "select";
}

function handleFontHotkeys(e) {
  // Require Ctrl/Cmd
  if (!(e.ctrlKey || e.metaKey)) return;
  if (shouldIgnoreHotkeyTarget(e.target)) return;

  const k = e.key;

  // Normalize: some keyboards send '+' only with Shift '=', some send 'Add'
  const isPlus = k === "+" || k === "=" || k === "Add" || k === "NumpadAdd";
  const isMinus = k === "-" || k === "Subtract" || k === "NumpadSubtract";
  const isZero = k === "0" || k === "Numpad0";

  if (isPlus) {
    e.preventDefault();
    incFont();
    return;
  }
  if (isMinus) {
    e.preventDefault();
    decFont();
    return;
  }
  if (isZero) {
    e.preventDefault();
    fontSize.value = clamp(DEFAULT_FONT, 10, 24);
    return;
  }
}
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function incFont() {
  fontSize.value = clamp(fontSize.value + 1, 10, 24);
}

function decFont() {
  fontSize.value = clamp(fontSize.value - 1, 10, 24);
}

async function startSaving() {
  const res = await window.LogSaver?.start();
  if (res?.started) {
    saving.value = true;
    savingPaused.value = false;
    savingPath.value = res.filepath || "";
    savingMsg.value = "A guardar...";
    lastSavePath.value = savingPath.value;
  } else {
    savingMsg.value = "Gravação cancelada";
  }
}
function initTooltips() {
  // dispose old
  tooltipInstances.forEach((t) => {
    try {
      t.dispose();
    } catch {}
  });
  tooltipInstances = [];
  // init new
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
    const tip = new bootstrap.Tooltip(el, { trigger: "hover" });
    tooltipInstances.push(tip);
  });
}

function hideAllTooltips() {
  tooltipInstances.forEach((t) => {
    try {
      t.hide();
    } catch {}
  });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function pad3(n) {
  return String(n).padStart(3, "0");
}
function isNearBottom(el, threshold = 24) {
  return el.scrollHeight - el.clientHeight - el.scrollTop <= threshold;
}

function makePrefix() {
  const cols = [];
  const now = new Date();

  // line number (keep the # — remove it if you want pure numeric)
  if (includeAll.value || showLineNo.value) cols.push(String(lineNo.value++)); // no '#'

  // time (HH:MM:SS.mmm)
  if (includeAll.value || showTime.value) {
    cols.push(
      `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(
        now.getSeconds()
      )}.${pad3(now.getMilliseconds())}`
    );
  }

  // date (YYYY-MM-DD)
  if (includeAll.value || showDate.value) {
    cols.push(
      `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
    );
  }

  // join with ';' and terminate with '; '
  return cols.length ? cols.join(";") + ";" : "";
}

// robust stick-to-bottom (decide before append; scroll after layout)
function addLineRaw(s) {
  if (skipNext.value) {
    skipNext.value = false;
    return;
  }

  const box = rawlogEl.value;
  const shouldStick =
    !box ||
    box.scrollHeight <= box.clientHeight ||
    box.scrollTop + box.clientHeight >= box.scrollHeight - 2;

  const line = makePrefix() + s;
  log.value.push(line);
  if (log.value.length > 5000) log.value.splice(0, log.value.length - 5000);

  nextTick(() => {
    if (shouldStick && bottomSentinel.value) {
      requestAnimationFrame(() =>
        bottomSentinel.value.scrollIntoView({ block: "end" })
      );
    }
  });

  // 🔴 append to saver on every line
  if (saving.value && !savingPaused.value && window.LogSaver) {
    window.LogSaver.append(line)
      .then((res) => {
        if (res?.queued != null) savingQueued.value = res.queued;
      })
      .catch(() => {
        savingMsg.value = "Erro ao gravar";
      });
  }
}

async function clearLog() {
  log.value = [];
  lineNo.value = 1;
  nextTick(() => {
    const el = rawlogEl.value;
    if (el) el.scrollTop = 0;
  });
  await nextTick();
  hideAllTooltips();
  await nextTick();
  initTooltips();
}

async function updateSavingStatus(s) {
  if (!s) return;
  saving.value = !!s.active;
  savingPaused.value = !!s.paused;
  savingPath.value = s.filepath || "";
  savingQueued.value = Number(s.queued || 0);
  savingMsg.value = saving.value
    ? savingPaused.value
      ? "Pausado"
      : "A guardar..."
    : "Inativo";
}

// ---------- actions ----------
function getPorts() {
  busy.value = true;
  socket.emit("getcoms");
}

async function connect() {
  if (!selectedPort.value) return;
  skipNext.value = true;
  socket.emit("conn", {
    port: selectedPort.value,
    baudRate: Number(selectedBaud.value),
  });

  connected.value = true;
  status.value = `Ligado a ${selectedPort.value} @ ${selectedBaud.value} bps`;
  // auto-resume saving into the same file (optional)
  if (autoResumeSaving.value && lastSavePath.value && window.LogSaver) {
    const res = await window.LogSaver.startPath(lastSavePath.value);
    if (res?.started) {
      saving.value = true;
      savingPaused.value = false;
      savingPath.value = res.filepath;
      savingMsg.value = "A guardar...";
    }
  }
  hideAllTooltips();
  await nextTick();
  initTooltips();
}

async function disconnect() {
  socket.emit("disconn");
  connected.value = false;
  status.value = "Desligado";
  // ⛔ force-stop saving
  if (window.LogSaver) {
    try {
      await window.LogSaver.stop();
    } catch {}
  }
  saving.value = false;
  savingPaused.value = false;
  savingMsg.value = "Terminado";
  // ✅ unset all extra data options immediately
  includeAll.value = false;
  showLineNo.value = false;
  showTime.value = false;
  showDate.value = false;

  // (optional) reset line counter if you want numbering to restart next time:
  // lineNo.value = 1

  // persist the state so it sticks
  localStorage.setItem(
    "rawlog_opts",
    JSON.stringify({
      showLineNo: showLineNo.value,
      showTime: showTime.value,
      showDate: showDate.value,
      includeAll: includeAll.value,
    })
  );
  hideAllTooltips();
  await nextTick();
  initTooltips();
}

// saving controls (preload exposes LogSaver)

async function pauseSaving() {
  if (window.LogSaver) {
    await window.LogSaver.pause();
    savingPaused.value = true;
    savingMsg.value = "Pausado";
  }
  await nextTick();
  initTooltips();
}
async function resumeSaving() {
  if (window.LogSaver) {
    await window.LogSaver.resume();
    savingPaused.value = false;
    savingMsg.value = "A guardar...";
  }
  await nextTick();
  initTooltips();
}
async function stopSaving() {
  await window.LogSaver?.stop();
  saving.value = false;
  savingPaused.value = false;
  savingMsg.value = "Terminado";
  await nextTick();
  initTooltips();
}

// ---------- effects ----------
watch(includeAll, (v) => {
  if (v) {
    showLineNo.value = false;
    showTime.value = false;
    showDate.value = false;
  }
});
watch(selectedBaud, (v) => localStorage.setItem("baudRate", v));
watch(logDark, (v) => localStorage.setItem("logDark", String(v)));
watch(logColor, (v) => localStorage.setItem("logColor", v));
watch(connected, async () => {
  await nextTick();
  const el = connBtn.value;
  if (!el) return;
  // If your Bootstrap version supports setContent (v5.2+), use it:
  const tip = bootstrap.Tooltip.getInstance(el);
  if (tip && tip.setContent) {
    tip.setContent({
      ".tooltip-inner": connected.value ? "Desligar" : "Ligar",
    });
  } else {
    // fallback: dispose & recreate
    if (tip) tip.dispose();
    new bootstrap.Tooltip(el, { trigger: "hover" });
  }
});
watch(fontSize, (v) => localStorage.setItem("logFontSize", String(v)));

onMounted(async () => {
  const savedFs = Number(localStorage.getItem("logFontSize") || "");
  if (!Number.isNaN(savedFs)) fontSize.value = clamp(savedFs, 10, 24);
  window.addEventListener("keydown", handleFontHotkeys, { passive: false });
  window.addEventListener("wheel", handleWheelZoom, { passive: false });
  // init tooltips
  await nextTick();
  if (connBtn.value) {
    new bootstrap.Tooltip(connBtn.value, { trigger: "hover" });
  }
  initTooltips();

  // restore prefs
  const savedDark = localStorage.getItem("logDark");
  if (savedDark !== null) logDark.value = savedDark === "true";
  const savedColor = localStorage.getItem("logColor");
  if (savedColor !== null) logColor.value = savedColor;
  const savedBaud = localStorage.getItem("baudRate");
  if (savedBaud && baudRates.includes(savedBaud))
    selectedBaud.value = savedBaud;

  // never auto-check "Todos" on startup
  includeAll.value = false;

  // sockets
  socket.on("coms", (list) => {
    ports.value = list || [];
    if (!selectedPort.value && ports.value.length)
      selectedPort.value = ports.value[0];
    busy.value = false;
  });
  socket.on("errors", (m) => {
    status.value = "Erro: " + (m || "");
    busy.value = false;
  });
  socket.on("porterror", (m) => {
    status.value = "Porta: " + (m || "");
    // stop saving as the connection dropped
    if (window.LogSaver) {
      window.LogSaver.stop().catch(() => {});
    }
    saving.value = false;
    savingPaused.value = false;
    savingMsg.value = "Terminado";
  });
  socket.on("data", (text) => addLineRaw(String(text ?? "")));

  socket.on("connect", () => {
    busy.value = true;
    socket.emit("getcoms");
    setTimeout(() => {
      if ((ports.value?.length || 0) === 0) socket.emit("getcoms");
    }, 800);
  });

  // saver callbacks
  if (window.LogSaver) {
    window.LogSaver.onStatus(updateSavingStatus);
    window.LogSaver.onError((m) => {
      savingMsg.value = "Erro: " + m;
    });
    window.LogSaver.status();
  }

  // app info for footer (from preload)
  if (window.AppInfo && typeof window.AppInfo.get === "function") {
    try {
      const info = await window.AppInfo.get();
      if (info)
        appInfo.value = {
          name: info.name || appInfo.value.name,
          version: info.version || appInfo.value.version,
        };
    } catch {}
  }

  // scroll listener (optional UI like "jump to bottom"); core stickiness is handled per-append
  nextTick(() => {
    rawlogEl.value?.addEventListener("scroll", () => {}, { passive: true });
  });
});

onBeforeUnmount(() => {
  rawlogEl.value?.removeEventListener("scroll", () => {});
  window.removeEventListener("keydown", handleFontHotkeys);
  window.removeEventListener("keydown", handleFontHotkeys);
  socket.close();
});
</script>

<style>
/* allow scroll child to size correctly inside nested flex */
.min-h-0 {
  min-height: 0 !important;
}

/* square icon buttons matching .btn-sm height */
.btn-icon {
  width: 34px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
</style>
