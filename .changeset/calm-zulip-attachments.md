---
"@onebots/adapter-zulip": patch
"@onebots/core": patch
---

补齐 Zulip 附件列表、删除、临时 URL 和缩略图状态 API，默认订阅并投影附件增改删事件；同时拆分 Zulip Event Queue 协议类型，保持 REST 与事件模块边界清晰。
