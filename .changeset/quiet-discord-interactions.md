---
"@onebots/adapter-discord": patch
---

统一 Discord Interaction 的标准与结构化 HTTP 入站，按 Interaction ID 重放成功响应并允许失败重投；修正真实机器人身份和生命周期，补齐 Poll Vote、Activities callback、完整 followup 消息动作与全部 Gateway 主动事件。
