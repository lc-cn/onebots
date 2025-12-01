import {defineConfig} from "vite";
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
    server:{
        strictPort:false,
        port:6728,
        proxy: {
            '/api': {
                target: 'http://localhost:6727',
                changeOrigin: true
            }
        }
    },
    plugins:[
        vue(),
        AutoImport({
            resolvers: [ElementPlusResolver()],
        }),
        Components({
            resolvers: [ElementPlusResolver()],
        }),
    ],
    build:{
        outDir:'dist'
    }
})
