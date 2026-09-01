---
"@onebots/adapter-zulip": patch
---

将账号启动取消信号传播到 Zulip 身份验证与 Event Queue，并清理忽略取消后迟到创建的服务器队列，防止旧启动任务恢复账号状态。
