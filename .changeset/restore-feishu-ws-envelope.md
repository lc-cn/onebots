---
"@onebots/adapter-feishu": patch
---

恢复飞书/Lark 长连接 SDK 展平的官方事件 envelope，保留真实事件 ID、事件时间、应用与租户身份，避免重试去重和时序语义被本地接收时间覆盖。
