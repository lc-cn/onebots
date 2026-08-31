---
"@onebots/adapter-teams": patch
---

统一校验 Microsoft Graph、Entra Authority 与 Bot Connector 的 HTTPS 配置边界，并修正 Koa 响应桥在 `end()` 后的 WebResponse 状态，避免 SDK 重复写入已结束响应。
