---
"@onebots/web": patch
---

修复加载协议端点配置时对 Vue 响应式对象使用 `structuredClone` 导致配置页无法打开的问题。
