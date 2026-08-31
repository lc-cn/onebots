---
"@onebots/core": patch
"onebots": patch
---

恢复并规范化宿主 `path` 的 HTTP Router 前缀，使运行时路由、状态检查与 doctor 使用同一部署地址，同时拒绝不安全的路径值。
