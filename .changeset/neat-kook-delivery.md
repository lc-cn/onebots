---
"@onebots/adapter-kook": patch
---

修正 KOOK Gateway 与 Webhook 在业务事件投递前提前确认序号的问题，改为成功后提交，并在失败时保留可重投状态。
