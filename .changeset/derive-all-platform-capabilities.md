---
"@onebots/adapter-discord": patch
"@onebots/adapter-qq": patch
"@onebots/adapter-whatsapp": patch
---

将 QQ、Discord 与 WhatsApp 的平台扩展能力改为由实际动作注册表生成，并保留权限、场景与上下文约束。全仓统一契约会持续校验每个平台动作均可被能力发现，避免新增 API 时出现注册表与清单漂移。
