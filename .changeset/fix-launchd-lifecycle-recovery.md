---
"onebots": patch
---

修复 macOS launchd 首次启动的 `(never exited)` 状态和启停期间 `xpcproxy`、`SIGTERMed` 瞬态导致管理服务操作误判为中断的问题；启动回执丢失后可按原操作 ID 对账已运行实例。
