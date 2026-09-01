---
"@onebots/adapter-email": patch
---

将账号启动取消信号传播到邮件客户端，在超时或热重载取消时关闭 SMTP 校验、IMAP、轮询与重连任务，并阻止迟到连接恢复账号状态。
