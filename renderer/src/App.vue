<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from "vue";
import { io } from "socket.io-client";

const socket = io("http://127.0.0.1:17865");

const ports = ref([]);
const selectedPort = ref("");
const connected = ref(false);
const busy = ref(false);
const status = ref("");
const showLineNo = ref(false);
const showTime = ref(false);
const showDate = ref(false);
const includeAll = ref(false);

const logColor = ref("#00ff66");

const logDark = ref(true); // default dark

const log = ref([]);

function addLine(s) {
  const line = makePrefix() + s;
  log.value.push(line);
  if (log.value.length > 5000) log.value.splice(0, log.value.length - 5000);
}

function clearLog() {
  log.value = [];
}

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

onMounted(() => {
  const savedLogBack = localStorage.getItem("logDark");
  if (savedLogBack !== null) logDark.value = savedLogBack === "true";
  const colorsaved = localStorage.getItem("logColor");
  if (colorsaved) logColor.value = colorsaved;
  const saved = JSON.parse(localStorage.getItem("rawlog_opts") || "{}");
  showLineNo.value = !!saved.showLineNo;
  showTime.value = !!saved.showTime;
  showDate.value = !!saved.showDate;
  includeAll.value = !!saved.includeAll;
  status.value = "Desligado";
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
  socket.on("data", (text) => addLine(String(text ?? "")));
  getPorts();
});

watch(logDark, (v) => localStorage.setItem("logDark", String(v)));

watch(logColor, (v) => localStorage.setItem("logColor", v));

watch(
  [showLineNo, showTime, showDate, includeAll],
  () => {
    localStorage.setItem(
      "rawlog_opts",
      JSON.stringify({
        showLineNo: showLineNo.value,
        showTime: showTime.value,
        showDate: showDate.value,
        includeAll: includeAll.value,
      })
    );
  },
  { deep: true }
);
watch(includeAll, (v) => {
  if (v) {
    // uncheck individuals when All is selected
    showLineNo.value = false;
    showTime.value = false;
    showDate.value = false;
  }
});

// computed colors (only two modes)
const logBg = computed(() => (logDark.value ? "#000" : "#fff"));
const logFg = computed(() => (logDark.value ? "#fff" : "#000"));

onBeforeUnmount(() => socket.close());

// line numbering
const lineNo = ref(1);

function pad2(n) {
  return String(n).padStart(2, "0");
}
function pad3(n) {
  return String(n).padStart(3, "0");
}

function makePrefix() {
  const all = includeAll.value;
  const parts = [];

  if (all || showLineNo.value) {
    parts.push(`#${lineNo.value}`); // number first so time/date read naturally
    lineNo.value += 1;
  }

  if (all || showTime.value) {
    const now = new Date();
    const t = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(
      now.getSeconds()
    )}.${pad3(now.getMilliseconds())}`;
    parts.push(t);
  }

  if (all || showDate.value) {
    const now = new Date();
    const d = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(
      now.getDate()
    )}`;
    parts.push(d);
  }

  return parts.length ? `[${parts.join(" ")}] ` : "";
}
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
          <!-- Checkboxes -->
          <div class="form-check form-check-inline">
            <input
              class="form-check-input"
              type="checkbox"
              id="optAll"
              v-model="includeAll"
            />
            <label class="form-check-label small" for="optAll">All</label>
          </div>

          <div class="form-check form-check-inline">
            <input
              class="form-check-input"
              type="checkbox"
              id="optLn"
              v-model="showLineNo"
              :disabled="includeAll"
            />
            <label class="form-check-label small" for="optLn">Line #</label>
          </div>

          <div class="form-check form-check-inline">
            <input
              class="form-check-input"
              type="checkbox"
              id="optTime"
              v-model="showTime"
              :disabled="includeAll"
            />
            <label class="form-check-label small" for="optTime">Time</label>
          </div>

          <div class="form-check form-check-inline">
            <input
              class="form-check-input"
              type="checkbox"
              id="optDate"
              v-model="showDate"
              :disabled="includeAll"
            />
            <label class="form-check-label small" for="optDate">Date</label>
          </div>
          <div class="d-flex align-items-center gap-2">
            <label for="logColor" class="small text-muted me-1">Text:</label>
            <input
              id="logColor"
              type="color"
              v-model="logColor"
              style="
                width: 32px;
                height: 24px;
                padding: 0;
                border: 0;
                background: none;
              "
            />
          </div>
          <div class="form-check form-switch ms-2">
            <input
              class="form-check-input"
              type="checkbox"
              id="logBgSwitch"
              v-model="logDark"
            />
            <label class="form-check-label small" for="logBgSwitch">
              {{ logDark ? "Dark" : "Light" }}
            </label>
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
