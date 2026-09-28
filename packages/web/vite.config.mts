import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    server: {
        strictPort: false,
        port: 6728,
        proxy: {
            "/api": {
                target: "http://127.0.0.1:6727",
                // 保留浏览器访问的 Host，使控制接口的同源检查仍然有效。
                changeOrigin: false,
            },
        },
    },
    plugins: [vue(), tailwindcss()],
    build: {
        outDir: "dist",
    },
});
