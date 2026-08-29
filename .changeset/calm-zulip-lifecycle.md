---
"@onebots/adapter-zulip": patch
---

修正 Zulip Event Queue 快速重启时的轮询代次竞争，统一使用认证后的真实 Bot 身份投影事件与状态，并补齐默认心跳、重启订阅及队列超时类型。
