---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-heychat": patch
"@onebots/adapter-line": patch
---

将远程 canonical 路由限制在正式 Adapter 动作面，显式修复 `get_supported_actions` 调用，并拒绝会被 canonical 路由遮蔽的平台扩展动作。移除 HeyChat 频道管理与 LINE 退群动作的重复注册；这些能力继续通过对应 canonical 动作提供。
