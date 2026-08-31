---
"@onebots/core": patch
"onebots": patch
---

就绪端点与 Prometheus 指标现在会验证磁盘配置是否仍与当前运行版本一致；配置漂移、文件不可读或等待重启时返回 HTTP 503，doctor 会给出对应原因，避免编排系统继续把不可安全重启的实例视为就绪。
