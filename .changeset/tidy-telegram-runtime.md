---
"@onebots/adapter-telegram": patch
"@onebots/core": patch
---

统一 Telegram polling/webhook 生命周期、原始 Update 接收与结构化错误边界，补齐无限重连、事件去重、Reaction/批量删除/交互与原生 mention 投影，并扩展动态接收配置和完整 Bot API 调用能力。修正无 caption 媒体吞文本、ID 校验及代理运行时依赖归属。
