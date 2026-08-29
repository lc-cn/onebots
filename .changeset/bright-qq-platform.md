---
"@onebots/adapter-qq": patch
---

改用腾讯官方 Node.js SDK，重构 QQ 消息、事件、Webhook 与 OpenAPI 分层；Webhook 复用 OneBots 主 HTTP 服务，补齐完整原始事件、无限连接代次、结构化错误、丰富配置 Schema 与平台扩展能力。
