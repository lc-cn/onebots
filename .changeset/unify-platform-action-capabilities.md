---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-dingtalk": patch
"@onebots/adapter-email": patch
"@onebots/adapter-feishu": patch
"@onebots/adapter-heychat": patch
"@onebots/adapter-icqq": patch
"@onebots/adapter-kook": patch
"@onebots/adapter-line": patch
"@onebots/adapter-slack": patch
"@onebots/adapter-teams": patch
"@onebots/adapter-telegram": patch
"@onebots/adapter-wechat-clawbot": patch
"@onebots/adapter-wechat": patch
"@onebots/adapter-wecom-kf": patch
"@onebots/adapter-wecom": patch
"@onebots/adapter-zulip": patch
---

统一由平台动作注册表派生不可变能力描述，保留各平台权限、上下文与场景差异，避免动作实现、Web 能力展示和支持动作查询发生漂移；微信公众号原生语言参数查询改用不与 canonical 动作冲突的 `get_wechat_user_info`。
