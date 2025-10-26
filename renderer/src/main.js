import { createApp } from "vue";
import App from "./App.vue";

// Local Bootstrap (bundled by Vite; no CDNs at runtime)
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "bootstrap-icons/font/bootstrap-icons.css";

createApp(App).mount("#app");
