---
"@onebots/web": patch
---

显式加载 Vite 客户端环境类型，修复干净构建环境中 `import.meta.env` 缺少类型声明导致的构建失败。
