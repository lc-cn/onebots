---
"@onebots/adapter-wechat": patch
---

重构微信公众号适配器：增加可嵌入的安全 Webhook 与统一 ingest、完整事件投影、精确被动回复、原生媒体与管理动作、通用 `wechat_call`、结构化错误及严格 snake_case 配置；移除将用户标签伪装为群聊的旧模型。
