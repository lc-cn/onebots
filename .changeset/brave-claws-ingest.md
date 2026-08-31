---
"@onebots/adapter-wechat-clawbot": patch
"@onebots/docs": patch
---

增加显式 `polling | manual` 接收模式；manual 保留 iLink 登录态与出站能力，但不创建内置长轮询，由现有 Host 调用 `WechatIlinkBot.ingest()` 接入事件。
