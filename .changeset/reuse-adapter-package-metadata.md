---
"@onebots/adapter-email": patch
"@onebots/adapter-heychat": patch
"@onebots/adapter-mock": patch
"@onebots/adapter-wechat-clawbot": patch
"@onebots/adapter-zulip": patch
---

复用 core 的包元数据读取模块，移除适配器内重复且会静默回落为 `unknown` 的版本读取逻辑，并为 Heychat 与 Mock 补充实际适配器包版本。
