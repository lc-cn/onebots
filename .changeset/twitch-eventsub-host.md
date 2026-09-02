---
"@onebots/adapter-twitch": patch
"@onebots/core": patch
"@onebots/web": patch
"@onebots/docs": patch
"onebots": patch
---

新增完整 Twitch Helix 与稳定 EventSub 适配器，支持主动 WebSocket、签名 Webhook、已有 HTTP Host、已有 socket 和 manual ingress，共享严格验证、可靠去重、动态能力及结构化配置表单；同时让通用 record-list 支持行内下拉与条件字段，并发布 Twitch 能力目录。
