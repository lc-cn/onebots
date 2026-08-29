---
"@onebots/adapter-zulip": patch
"@onebots/docs": patch
"@onebots/core": patch
"@onebots/web": patch
---

重构 Zulip 适配器：改用官方 Event Queue 长轮询与原生 HTTP 客户端，补齐可靠重连、结构化错误、可嵌入 Client、原始事件入口、频道话题、真实订阅成员、文件上传、事件投影和平台扩展动作；同时抽取可复用的动态选项列表表单，完善 Schema 与中英文文档。
