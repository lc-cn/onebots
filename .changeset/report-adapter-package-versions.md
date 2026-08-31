---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-discord": patch
"@onebots/adapter-feishu": patch
"@onebots/adapter-slack": patch
"@onebots/adapter-telegram": patch
---

新增统一的包版本读取工具，并让 Discord、飞书/Lark、Slack 与 Telegram 的版本接口返回实际发布版本，不再固定报告 `1.0.0`。
