<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { io } from "socket.io-client";

// Connect to the local Socket.IO server hosted by Electron main
const socket = io("http://127.0.0.1:17865");

// UI state
const ports = ref([]);
const selectedPort = ref("");
const connected = ref(false);
const busy = ref(false);
const status = ref("");

// Raw log + canvas refs
const log = ref([]);
const rawlogEl = ref(null);
const canvas = ref(null);

// Range controls
const yMinInput = ref("");
const yMaxInput = ref("");
let yMin = null,
  yMax = null;
watch([yMinInput, yMaxInput], () => {
  const a = Number(yMinInput.value),
    b = Number(yMaxInput.value);
  yMin = Number.isFinite(a) ? a : null;
  yMax = Number.isFinite(b) ? b : null;
});

// Numeric plot ring buffer
const CAP = 5000;
const buf = new Float32Array(CAP);
let head = 0,
  count = 0;
function push(v) {
  buf[head] = v;
  head = (head + 1) % CAP;
  count = Math.min(count + 1, CAP);
}
function at(i) {
  const idx = (head - count + i + CAP) % CAP;
  return buf[idx];
}

function addLine(s) {
  log.value.push(s);
  if (log.value.length > 2000) log.value.splice(0, log.value.length - 2000);
  queueMicrotask(() => {
    if (rawlogEl.value) rawlogEl.value.scrollTop = rawlogEl.value.scrollHeight;
  });
}
function clearLog() {
  log.value = [];
}
function resetRange() {
  yMinInput.value = "";
  yMaxInput.value = "";
  yMin = null;
  yMax = null;
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
  socket.on("data", (text) => {
    const s = String(text ?? "");
    addLine(s);
    const n = Number(s.trim());
    if (Number.isFinite(n)) push(n);
  });

  getPorts();
  requestAnimationFrame(draw);
});

onBeforeUnmount(() => {
  socket.close();
});

function draw() {
  const cvs = canvas.value;
  if (!cvs) {
    requestAnimationFrame(draw);
    return;
  }
  const ctx = cvs.getContext("2d");
  const w = cvs.clientWidth,
    h = cvs.clientHeight;
  if (cvs.width !== w) cvs.width = w;
  if (cvs.height !== h) cvs.height = h;
  ctx.clearRect(0, 0, w, h);

  // grid
  ctx.globalAlpha = 0.25;
  for (let x = 0; x < w; x += Math.ceil(w / 10)) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += Math.ceil(h / 6)) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (count > 1) {
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < count; i++) {
      const v = at(i);
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      min = -1;
      max = 1;
    }
    if (yMin != null) min = yMin;
    if (yMax != null) max = yMax;
    const range = max - min || 1;

    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const v = at(i);
      if (!Number.isFinite(v)) continue;
      const x = Math.floor((i / (CAP - 1)) * (w - 1));
      const y = Math.floor(h - ((v - min) / range) * (h - 1));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  requestAnimationFrame(draw);
}
</script>

<template>
  <div
    class="container mt-3 pt-2 ps-3 pe-3"
    style="border: 2px solid #093fa5; border-radius: 10px"
  >
    <h1 class="ms-3">CanSat Dashboard (Raw · Vue)</h1>

    <div class="row mb-2 mt-3 ms-3">
      <div class="col-2">
        <button class="btn btn-primary mb-2" @click="getPorts" :disabled="busy">
          OBTER PORTAS
        </button>
      </div>
      <div class="col-2">
        <select class="form-select mb-2 text-center" v-model="selectedPort">
          <option v-for="p in ports" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>
      <div class="col-3">
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

    <div class="row text-center mb-2 ms-1">
      <div class="col-4 text-center">
        <div class="input-group mb-3">
          <button class="btn btn-secondary" type="button" @click="resetRange">
            Reset
          </button>
          <input
            type="text"
            class="form-control text-center"
            placeholder="min"
            v-model="yMinInput"
          />
          <input
            type="text"
            class="form-control text-center"
            placeholder="max"
            v-model="yMaxInput"
          />
        </div>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-header">Plot (numeric raw lines)</div>
      <div class="card-body">
        <canvas
          id="plot"
          ref="canvas"
          style="width: 100%; height: 400px; display: block; background: #fff"
        ></canvas>
        <div class="form-text">
          Linhas não numéricas são ignoradas no gráfico (mas aparecem no log).
        </div>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between">
        <span>Raw Lines</span>
        <span class="small text-muted">{{ status }}</span>
      </div>
      <div class="card-body">
        <div
          id="rawlog"
          ref="rawlog"
          style="
            height: 160px;
            overflow: auto;
            font-family: ui-monospace, Menlo, Consolas, monospace;
            background: #111;
            color: #0f0;
            padding: 8px;
            border-radius: 6px;
          "
        >
          <div v-for="(line, i) in log" :key="i">{{ line }}</div>
        </div>
        <button class="btn btn-sm btn-outline-secondary mt-2" @click="clearLog">
          Limpar
        </button>
      </div>
    </div>
  </div>
</template>
