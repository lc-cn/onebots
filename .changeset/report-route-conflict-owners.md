---
"@onebots/core": patch
onebots: patch
---

账号作用域内的 HTTP 与 WebSocket 路由冲突现在会同时报告正在注册和已占用路径的平台与账号，热重载失败时也会保留这些诊断并恢复旧账号路由。
