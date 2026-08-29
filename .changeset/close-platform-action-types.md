---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-dingtalk": patch
"@onebots/adapter-discord": patch
"@onebots/adapter-email": patch
"@onebots/adapter-feishu": patch
"@onebots/adapter-heychat": patch
"@onebots/adapter-icqq": patch
"@onebots/adapter-kook": patch
"@onebots/adapter-line": patch
"@onebots/adapter-qq": patch
"@onebots/adapter-slack": patch
"@onebots/adapter-teams": patch
"@onebots/adapter-telegram": patch
"@onebots/adapter-wechat": patch
"@onebots/adapter-wechat-clawbot": patch
"@onebots/adapter-wecom": patch
"@onebots/adapter-wecom-kf": patch
"@onebots/adapter-whatsapp": patch
"@onebots/adapter-zulip": patch
---

闭合平台动作类型：不可变动作集合保留精确联合类型并支持动态字符串收窄，所有适配器从包入口统一导出动作集合、执行器与动作类型。
