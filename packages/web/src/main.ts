import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/main.css";

const app = createApp(App);

app.use(router);

app.mount("#app");
