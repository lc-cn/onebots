---
"@onebots/adapter-email": patch
---

增加 IMAP STATUS、quota、NOOP、原始邮件追加与 flags 覆盖动作，统一精确参数校验，并把 UIDVALIDITY/MODSEQ 响应转换为可序列化字符串。
