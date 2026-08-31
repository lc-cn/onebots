---
"@onebots/core": patch
"@onebots/adapter-feishu": patch
"@onebots/adapter-kook": patch
"@onebots/adapter-slack": patch
---

修正适配器能力清单的动态权限语义，并让飞书、KOOK 与 Slack 平台扩展动作完整接入统一能力契约，避免模块加载或查询支持动作时误报失败。
