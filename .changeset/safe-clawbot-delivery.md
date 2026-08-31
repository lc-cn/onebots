---
"@onebots/adapter-wechat-clawbot": patch
---

修正 iLink 长轮询把业务投递失败当作毒事件跳过的问题，改为成功后确认、失败重拉，并在会话持久化失败时回滚内存游标。
