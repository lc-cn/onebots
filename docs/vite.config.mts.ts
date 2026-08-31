import {defineConfig} from "vite";
import { createStyleImportPlugin } from "vite-plugin-style-import"
export default defineConfig({
    resolve:{
        alias:{
            vue:'vue/dist/vue.esm-bundler.js'
        }
    },
    plugins:[
        createStyleImportPlugin({
            libs:[
                {
                    libraryName: 'element-plus',
                    resolveStyle: (name) => {
                        return `element-plus/lib/theme-chalk/${name}.css`;
                    }
                }
            ]
        })
    ]
})
