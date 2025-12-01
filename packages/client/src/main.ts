import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import 'element-plus/theme-chalk/dark/css-vars.css'

const app = createApp(App);

app.use(router);

app.mount("#app");
