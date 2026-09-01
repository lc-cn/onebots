---
"@onebots/core": patch
"@onebots/adapter-discord": patch
"@onebots/adapter-line": patch
"@onebots/adapter-slack": patch
"@onebots/adapter-telegram": patch
---

把账号启动取消信号传入长连接工厂，并让 Discord、LINE、Slack 与 Telegram 在超时后停止未完成连接或忽略迟到的上线结果。
