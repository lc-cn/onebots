---
"@onebots/adapter-email": patch
---

增加不创建 IMAP 连接的 manual 接收模式，允许外部邮件系统通过 EmailClient.ingest 投递事件并继续使用 SMTP。
