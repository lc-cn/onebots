---
"@onebots/core": patch
"onebots": patch
---

配置热重载期间让 readiness 返回不可用并暴露重载指标，同时拒绝并发重载，避免编排系统向尚未完成切换的账号与协议出口转发流量。
