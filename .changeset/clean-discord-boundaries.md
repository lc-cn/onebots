---
"@onebots/adapter-discord": patch
---

重构 Discord Gateway、REST 与 Interactions 边界：增加无限恢复与心跳 ACK 检测、session-aware 事件 ID、AbortSignal、分片和完整 Presence 配置；REST 增加 Discord bucket/global 限流调度、429 重试、可注入传输、结构化错误、审计原因及安全路径校验；主适配器增加复用现有 HTTP Host 的 Interactions 模式与手动 ingest，补齐 deferred/followup 动作、批量事件、partial message update、提及与 Embed 投影、Guild/成员/历史消息分页，并同步完善动态 Schema、公开类型、测试与 README。
