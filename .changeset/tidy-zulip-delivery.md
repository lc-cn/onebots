---
"@onebots/adapter-zulip": patch
---

修正 Zulip Event Queue 在业务监听器失败前提前推进游标的问题，统一 canonical 事件的成功提交、重投与有界去重语义。
