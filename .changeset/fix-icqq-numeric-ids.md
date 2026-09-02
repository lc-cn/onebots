---
"@onebots/adapter-icqq": patch
---

修复 ICQQ 好友、成员、账号和群资料中的数字 QQ 号与群号被错误映射为随机统一 ID；现在直接保留原始数字，并由 `createId()` 生成对应字符串形式。
