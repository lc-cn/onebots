---
"@onebots/adapter-qq": patch
---

修复 QQ Webhook 在协议业务完成前提前确认的问题，并为 manual 模式增加标准 `acceptHttp(Request)` 结构化响应入口；所有 HTTP Host 继续共享官方 SDK 验签、事件投影与去重状态。
