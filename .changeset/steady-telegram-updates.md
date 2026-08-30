---
"@onebots/adapter-telegram": patch
---

让 Telegram Webhook、manual 与 polling 共用可等待、并发合并且成功后提交的完整 grammY Update 管线，协议或细分事件监听器失败时不再提前确认 update_id。

改为显式管理 getUpdates offset，只有逐条业务投递成功后才推进，失败从原 update_id 重拉；保留无限退避、停止信号、30 秒长轮询默认值与结构化错误传播，并更新 README 和回归测试。
