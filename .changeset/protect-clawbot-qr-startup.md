---
"@onebots/core": patch
"@onebots/adapter-wechat-clawbot": patch
"@onebots/web": patch
---

允许适配器按账号抬高完整启动事务的保护窗口，并在账号摘要中公开最终生效值。

微信 ClawBot 现在会保留默认 480 秒扫码窗口，同时响应账号启动取消信号，避免被全局 30 秒默认值提前中断。
