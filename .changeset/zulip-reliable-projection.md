---
"@onebots/adapter-zulip": patch
---

让手动与 Event Queue 入口等待 raw、精确类型、canonical 监听器及协议投影完成，成功后才提交去重和队列游标；启动失败不再被适配器静默吞掉。
