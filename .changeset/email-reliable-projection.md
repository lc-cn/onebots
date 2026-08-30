---
"@onebots/adapter-email": patch
---

让手动与 IMAP 邮件入口等待 raw、canonical 监听器和协议投影完成，只有业务成功后才提交去重与 Seen 进度；启动失败不再被适配器静默吞掉。
