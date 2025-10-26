<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import { io } from "socket.io-client";

const socket = io("http://127.0.0.1:17865");

const ports = ref([]);
const selectedPort = ref("");
const connected = ref(false);
const busy = ref(false);
const status = ref("");

const log = ref([]);

function addLine(s) {
  log.value.push(s);
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

onBeforeUnmount(() => socket.close());
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
          <span class="small text-muted ms-auto">{{ status }}</span>
        </div>

        <!-- Make the body a flex column that can shrink; the log fills it -->
        <div class="card-body p-0 d-flex flex-column min-h-0">
          <!-- This grows to occupy the whole leftover height; scrolls on overflow -->
          <div
            class="flex-grow-1 overflow-auto bg-dark text-success font-monospace"
            style="padding: 8px 10px 6px 10px"
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
