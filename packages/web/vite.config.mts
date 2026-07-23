import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    server: {
        strictPort: false,
        port: 6728,
        proxy: {
            "/api": {
                target: "http://localhost:6727",
                changeOrigin: true,
            },
        },
    },
    plugins: [vue(), tailwindcss()],
    build: {
        outDir: "dist",
    },
});
