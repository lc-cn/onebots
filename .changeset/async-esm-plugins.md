---
"onebots": patch
---

插件加载器从插件工作目录解析 `exports.import`、`module` 或 `main` 入口，再使用原生动态 `import()` 并等待初始化完成；支持 import-only、条件导出及包含顶层 `await` 的纯 ESM 插件，同时保留初始化失败的具体诊断。
