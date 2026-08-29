---
"@onebots/adapter-discord": patch
---

移除重复包装 DiscordLite 的 DiscordLiteBot 浅模块，独立使用统一收口到同时支持 REST、Gateway 与 Interactions 的 DiscordLite 接口，并按配置、消息、Guild 与传输领域拆分公共类型实现。
