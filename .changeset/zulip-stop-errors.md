---
"@onebots/adapter-zulip": patch
---

Zulip 停止时完整等待轮询并删除事件队列，清理失败不再被日志吞掉。
