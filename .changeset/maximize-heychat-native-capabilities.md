---
"@onebots/adapter-heychat": patch
---

重构黑盒语音适配器的 REST、WebSocket、事件投影与消息编译边界，按官方文档补齐私聊、富消息、回应、房间、成员、角色、频道、权限和语音流能力；移除未经官方定义的普通消息与 webhook 声明，并提供结构化错误、无限重连、受限底层 API、动态配置 Schema、准确 README 和回归测试。
