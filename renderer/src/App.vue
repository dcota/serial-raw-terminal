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

/* -------------------- socket -------------------- */
const socket = io("http://127.0.0.1:17865");

/* -------------------- state (declare FIRST) -------------------- */
// connection / ports
const ports = ref([]);
const selectedPort = ref("");
const connected = ref(false);
const busy = ref(false);
const status = ref("Desligado");

// raw log + scrolling
const log = ref([]);
const rawlogEl = ref(null);
const bottomSentinel = ref(null);

// prefix toggles
const showLineNo = ref(false);
const showTime = ref(false);
const showDate = ref(false);
const includeAll = ref(false);
const lineNo = ref(1);

// theme
const logDark = ref(true);
const logColor = ref("#00ff66");
const logBg = computed(() => (logDark.value ? "#000" : "#fff"));
const logFg = computed(() => (logDark.value ? logColor.value : "#000"));

const skipNext = ref(true); // skip the first incoming line

// --- Saving state ---
const saving = ref(false);
const savingPaused = ref(false);
const savingPath = ref("");
const savingQueued = ref(0);
const savingMsg = ref("");

const appInfo = ref({ name: "CanSat Terminal", version: "" });
const author = "Duarte Cota"; // <- edit as you like
const year = new Date().getFullYear();

/* -------------------- helpers -------------------- */
function updateSavingStatus(s) {
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

function isNearBottom(el, threshold = 24) {
  return el.scrollHeight - el.clientHeight - el.scrollTop <= threshold;
}

function handleScroll() {
  const el = rawlogEl.value;
  if (!el) return;
  // you can keep a ref if you want to show a “jump to bottom” button,
  // but you don't need it for auto-scroll anymore because we compute
  // shouldStick right before appending.
  // stickToBottom.value = isNearBottom(el)
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function pad3(n) {
  return String(n).padStart(3, "0");
}
function makePrefix() {
  const parts = [];
  const now = new Date();
  if (includeAll.value || showLineNo.value) parts.push(`#${lineNo.value++}`);
  if (includeAll.value || showTime.value) {
    parts.push(
      `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(
        now.getSeconds()
      )}.${pad3(now.getMilliseconds())}`
    );
  }
  if (includeAll.value || showDate.value) {
    parts.push(
      `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
    );
  }
  return parts.length ? `[${parts.join(" ")}] ` : "";
}

function addLineRaw(s) {
  if (skipNext.value) {
    // <- drop the first received line
    skipNext.value = false;
    return;
  }
  const el = rawlogEl.value;
  const shouldStick =
    !el || el.scrollHeight <= el.clientHeight || isNearBottom(el, 24);

  const line = makePrefix() + s;
  log.value.push(line);
  if (log.value.length > 5000) log.value.splice(0, log.value.length - 5000);
  if (saving.value && !savingPaused.value && window.LogSaver) {
    window.LogSaver.append(line)
      .then((res) => {
        if (res?.queued != null) savingQueued.value = res.queued;
      })
      .catch(() => {
        savingMsg.value = "Erro ao gravar";
      });
  }
  nextTick(() => {
    if (shouldStick && bottomSentinel.value) {
      requestAnimationFrame(() => {
        bottomSentinel.value.scrollIntoView({ block: "end" });
      });
    }
  });
}

function clearLog() {
  log.value = [];
  lineNo.value = 1;
  nextTick(() => {
    if (rawlogEl.value) rawlogEl.value.scrollTop = 0;
  });
}

/* -------------------- effects / watchers -------------------- */
// All → uncheck individuals
watch(includeAll, (v) => {
  if (v) {
    showLineNo.value = false;
    showTime.value = false;
    showDate.value = false;
  }
});
// persist theme
watch(logDark, (v) => localStorage.setItem("logDark", String(v)));
watch(logColor, (v) => localStorage.setItem("logColor", v));

/* -------------------- socket commands -------------------- */
function getPorts() {
  busy.value = true;
  socket.emit("getcoms");
}
function connect() {
  if (!selectedPort.value) return;
  skipNext.value = true;
  socket.emit("conn", selectedPort.value);
  connected.value = true;
  status.value = `Ligado a ${selectedPort.value}`;
}
function disconnect() {
  socket.emit("disconn");
  connected.value = false;
  status.value = "Desligado";
}
async function startSaving() {
  if (!window.LogSaver) return;
  const res = await window.LogSaver.start();
  if (res?.started) {
    saving.value = true;
    savingPaused.value = false;
    savingPath.value = res.filepath || "";
    savingMsg.value = "A guardar...";
  } else {
    savingMsg.value = "Gravação cancelada";
  }
}
async function pauseSaving() {
  if (window.LogSaver) {
    await window.LogSaver.pause();
    savingPaused.value = true;
    savingMsg.value = "Pausado";
  }
}
async function resumeSaving() {
  if (window.LogSaver) {
    await window.LogSaver.resume();
    savingPaused.value = false;
    savingMsg.value = "A guardar...";
  }
}
async function stopSaving() {
  if (window.LogSaver) {
    await window.LogSaver.stop();
    saving.value = false;
    savingPaused.value = false;
    savingMsg.value = "Terminado";
  }
}
/* -------------------- lifecycle -------------------- */
onMounted(() => {
  if (window.LogSaver) {
    window.LogSaver.onStatus(updateSavingStatus);
    window.LogSaver.onError((m) => {
      savingMsg.value = "Erro: " + m;
    });
    window.LogSaver.status(); // fetch initial
  }
  const savedDark = localStorage.getItem("logDark");
  const savedColor = localStorage.getItem("logColor");
  if (savedDark !== null) logDark.value = savedDark === "true";
  if (savedColor !== null) logColor.value = savedColor;
  const saved = JSON.parse(localStorage.getItem("rawlog_opts") || "{}");
  showLineNo.value = !!saved.showLineNo;
  showTime.value = !!saved.showTime;
  showDate.value = !!saved.showDate;
  includeAll.value = !!saved.includeAll;
  includeAll.value = false;
  if (window.AppInfo && typeof window.AppInfo.get === "function") {
    window.AppInfo.get()
      .then((info) => {
        if (info) {
          appInfo.value = {
            name: info.name || appInfo.value.name,
            version: info.version || appInfo.value.version,
          };
        }
      })
      .catch(() => {});
  }

  // socket events
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
  });
  socket.on("data", (text) => addLineRaw(String(text ?? "")));

  // ask ports after socket connects (prevents race)
  socket.on("connect", () => {
    busy.value = true;
    socket.emit("getcoms");
    setTimeout(() => {
      if ((ports.value?.length || 0) === 0) socket.emit("getcoms");
    }, 800);
  });

  // attach scroll listener once element exists
  nextTick(() => {
    rawlogEl.value?.addEventListener("scroll", handleScroll, { passive: true });
  });
});

onBeforeUnmount(() => {
  rawlogEl.value?.removeEventListener("scroll", handleScroll);
  socket.close();
});
</script>

<template>
  <!-- Full viewport height column -->
  <div class="d-flex flex-column vh-100">
    <!-- Top controls (natural height) -->
    <div class="container mt-3 pt-2 ps-3 pe-3">
      <div class="d-flex align-items-center justify-content-between">
        <h1 class="ms-3 mb-2">CanSat Terminal</h1>
      </div>

      <!--buttons-->
      <div class="row g-2 ms-3 align-items-end">
        <!-- LEFT: ports + connect -->
        <div class="col-auto">
          <button class="btn btn-primary" @click="getPorts" :disabled="busy">
            OBTER PORTAS
          </button>
        </div>

        <div class="col-auto">
          <select
            class="form-select text-center"
            v-model="selectedPort"
            style="min-width: 200px"
          >
            <option v-for="p in ports" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>

        <div class="col-auto">
          <button
            class="btn btn-success"
            @click="connect"
            :disabled="!selectedPort || connected"
          >
            LIGAR
          </button>
          <button
            class="btn btn-danger ms-2"
            @click="disconnect"
            :disabled="!connected"
          >
            DESLIGAR
          </button>
        </div>

        <!-- RIGHT: Guardar / Pausar / Retomar / Terminar -->
        <div class="col ms-auto text-end">
          <div class="d-inline-flex gap-2">
            <button
              class="btn btn-sm btn-outline-primary"
              @click="startSaving"
              :disabled="saving"
            >
              Guardar
            </button>
            <button
              class="btn btn-sm btn-outline-warning"
              v-if="saving && !savingPaused"
              @click="pauseSaving"
            >
              Pausar
            </button>
            <button
              class="btn btn-sm btn-outline-success"
              v-if="saving && savingPaused"
              @click="resumeSaving"
            >
              Retomar
            </button>
            <button
              class="btn btn-sm btn-outline-danger"
              v-if="saving"
              @click="stopSaving"
            >
              Terminar
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Log area fills ALL remaining height from the start -->
    <div class="container flex-grow-1 d-flex min-h-0 mt-2 mb-2">
      <!-- Single card (border kept) -->
      <div class="card flex-grow-1 d-flex min-h-0">
        <div class="card-header d-flex align-items-center">
          <span>LOG</span>

          <!-- Middle: controls, centered between the two spans -->
          <div
            class="flex-grow-1 d-flex justify-content-center align-items-center flex-wrap gap-3"
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
                <label class="form-check-label ms-1 mb-0 me-5" for="optAll"
                  >Todos</label
                >
              </div>
            </div>

            <!-- Color picker (used in dark mode) -->
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

            <!-- Dark/Light switch -->
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

          <!-- Right: status -->
          <span class="small text-muted ms-auto">{{ status }}</span>
        </div>

        <!-- Single card body (no nested card) -->
        <div class="card-body p-0 d-flex flex-column min-h-0">
          <!-- scrollable log fills remaining height -->
          <div
            ref="rawlog"
            class="flex-grow-1 overflow-auto font-monospace"
            :style="{
              backgroundColor: logBg,
              color: logFg,
              padding: '8px 10px 6px 10px',
            }"
          >
            <div v-for="(line, i) in log" :key="i">{{ line }}</div>
            <div ref="bottomSentinel" style="height: 1px"></div>
          </div>

          <div
            class="d-flex justify-content-between align-items-center p-2 pt-1"
          >
            <!-- left: status text -->
            <div
              class="small text-muted text-truncate me-3"
              style="max-width: 60%"
            >
              {{ savingPath ? savingMsg + " • " + savingPath : savingMsg }}
            </div>

            <!-- right: button -->
            <button class="btn btn-sm btn-outline-secondary" @click="clearLog">
              Limpar
            </button>
          </div>
        </div>
      </div>
    </div>
    <!-- Footer -->
    <div class="container mt-auto py-2 border-top small text-muted">
      <div
        class="d-flex align-items-center justify-content-between flex-wrap gap-2"
      >
        <!-- left: icon + name -->
        <div class="d-flex align-items-center gap-2">
          <img
            src="./assets/cansat_logo.png"
            alt=""
            style="width: 72px; height: 72px"
          />
          <span>{{ appInfo.name || "CanSat Terminal" }}</span>
        </div>

        <!-- middle: version -->
        <div class="text-nowrap">{{ appInfo.version || "ESERO Portugal" }}</div>

        <!-- right: copyright -->
        <div class="text-nowrap">&copy; {{ year }} {{ author }}</div>
      </div>
    </div>
  </div>
</template>

<style>
/* Ensure flex children can actually shrink and allow the overflow container to size correctly */
html,
body,
#app {
  height: 100%;
}
.min-h-0 {
  min-height: 0 !important;
}
</style>
