---
"@onebots/adapter-whatsapp": patch
---

闭合 WhatsApp Webhook 与生命周期的可靠投递语义：按原始顺序尝试全部事件视图和监听器，任一出口失败时不提交去重并触发重投；manual 配置同时明确 `ingestHttp()` 与 `acceptHttp()` 所需凭据。
