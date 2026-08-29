---
"@onebots/adapter-telegram": patch
"@onebots/adapter-line": patch
"@onebots/adapter-slack": patch
---

为 Telegram 提供受控的完整 Bot API 调用入口，并报告真实 grammY SDK 版本。

移除 Telegram、LINE 与 Slack 中能力清单之外的占位标准动作，使不支持能力统一返回结构化错误。
