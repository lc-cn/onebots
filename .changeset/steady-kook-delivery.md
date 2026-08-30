---
"@onebots/adapter-kook": patch
---

让 KOOK Gateway、Webhook 与 manual 接入等待 canonical 事件和全部协议出口成功后再确认 `sn`，并发 Webhook 会合并相同序号，Gateway 则串行投递并在失败或 reconnect 时使旧队列失效。

补齐消息模板创建、更新、删除，以及机器人加入、列出、离开和保活语音频道的平台动作；同步更新能力说明、Schema 提示、README 与回归测试。
