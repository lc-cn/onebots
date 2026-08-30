---
"@onebots/adapter-heychat": patch
---

将 HeyChat 事件入口改为串行成功确认：业务失败不再提前推进序号，显式 ingest 可重投，socket 来源会按退避策略保留并重试事件，同时区分协议帧错误与业务投递错误。
