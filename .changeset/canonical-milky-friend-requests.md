---
"@onebots/core": patch
"@onebots/adapter-icqq": patch
"@onebots/protocol-milky-v1": patch
---

将 Milky 好友请求列表与处理动作改为真实 QQ UID 语义，补齐目标用户、状态、来源与过滤字段，并把 ICQQ opaque flag 隔离在适配器内部。
