---
"@onebots/core": patch
"onebots": patch
---

让协议、账号、适配器与生命周期钩子的停止失败彼此隔离，并在数据库、网络、安全审计和 close 监听器均获得清理机会后统一汇总错误。
