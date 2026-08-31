---
"@onebots/adapter-email": patch
"@onebots/docs": patch
---

重构邮件适配器：统一 SMTP/IMAP 认证与代理配置，改用 IMAP IDLE 和无限重连，补齐线程、HTML、附件、查询、标记、目录管理、结构化错误与可嵌入 EmailClient，并同步完善 Schema、能力清单、测试及中英文文档。
