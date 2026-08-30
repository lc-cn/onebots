---
"@onebots/adapter-telegram": patch
---

使 Telegram 停止流程完整等待 polling、Webhook 删除和异步停止监听器，单一步骤失败不再跳过后续清理。
