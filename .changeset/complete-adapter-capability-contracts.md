---
"@onebots/core": patch
"onebots": patch
"imhelper": patch
"@onebots/mcp-client": patch
"@imhelper/onebot-v11": patch
"@imhelper/onebot-v12": patch
"@imhelper/satori-v1": patch
"@onebots/adapter-dingtalk": patch
"@onebots/adapter-discord": patch
"@onebots/adapter-email": patch
"@onebots/adapter-feishu": patch
"@onebots/adapter-heychat": patch
"@onebots/adapter-kook": patch
"@onebots/adapter-line": patch
"@onebots/adapter-mock": patch
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
"@onebots/docs": patch
---

完成全平台适配器能力清单，统一声明原生、模拟、权限、场景、事件、消息段与传输能力，并在运行时校验已声明动作确有具体实现，避免管理端和协议层暴露虚假能力。
