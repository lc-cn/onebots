---
"@onebots/adapter-zulip": patch
---

以顶层 receive_mode 统一 Event Queue 与 manual 接入，移除 event_queue.enabled 并公开手动事件投递能力。
