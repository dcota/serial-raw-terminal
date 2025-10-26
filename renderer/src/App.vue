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
const stickToBottom = ref(true);

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

/* -------------------- helpers -------------------- */
function isNearBottom(el, threshold = 24) {
  return el.scrollHeight - el.clientHeight - el.scrollTop <= threshold;
}
function handleScroll() {
  const el = rawlogEl.value;
  if (!el) return;
  stickToBottom.value = isNearBottom(el);
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
  const line = makePrefix() + s;
  log.value.push(line);
  if (log.value.length > 5000) log.value.splice(0, log.value.length - 5000);
  nextTick(() => {
    const el = rawlogEl.value;
    if (el && stickToBottom.value) el.scrollTop = el.scrollHeight;
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
  socket.emit("conn", selectedPort.value);
  connected.value = true;
  status.value = `Ligado a ${selectedPort.value}`;
}
function disconnect() {
  socket.emit("disconn");
  connected.value = false;
  status.value = "Desligado";
}

/* -------------------- lifecycle -------------------- */
onMounted(() => {
  const savedDark = localStorage.getItem("logDark");
  const savedColor = localStorage.getItem("logColor");
  if (savedDark !== null) logDark.value = savedDark === "true";
  if (savedColor !== null) logColor.value = savedColor;
  const saved = JSON.parse(localStorage.getItem("rawlog_opts") || "{}");
  showLineNo.value = !!saved.showLineNo;
  showTime.value = !!saved.showTime;
  showDate.value = !!saved.showDate;
  includeAll.value = !!saved.includeAll;

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
      <h1 class="ms-3 mb-2">CanSat Dashboard (Raw)</h1>

      <div class="row g-2 ms-3 align-items-end">
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
      </div>
    </div>

    <!-- Log area fills ALL remaining height from the start -->
    <div class="container flex-grow-1 d-flex min-h-0 mt-5 mb-5">
      <div class="card flex-grow-1 d-flex min-h-0">
        <div class="card-header d-flex align-items-center">
          <span>ENTRADA DE DADOS</span>
          <!-- Middle: controls, centered between the two spans -->
          <div
            class="flex-grow-1 d-flex justify-content-center align-items-center flex-wrap gap-3"
          >
            <!-- All / Line / Time / Date -->
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

          <span class="small text-muted ms-auto">{{ status }}</span>
        </div>

        <!-- Make the body a flex column that can shrink; the log fills it -->
        <div class="card-body p-0 d-flex flex-column min-h-0">
          <!-- This grows to occupy the whole leftover height; scrolls on overflow -->
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
          </div>

          <div class="d-flex justify-content-end gap-2 p-2 pt-1">
            <button class="btn btn-sm btn-outline-secondary" @click="clearLog">
              Limpar
            </button>
          </div>
        </div>
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
} /* crucial for flex overflow areas */
</style>
