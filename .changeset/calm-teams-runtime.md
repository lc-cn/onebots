---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-slack": patch
"@onebots/adapter-telegram": patch
"@onebots/adapter-teams": patch
---

新增成功后提交的有界事件去重原语，并统一 Slack、Telegram 与 Teams 的重投语义。完善 Teams 标准 Request 入站、真实机器人身份、原始 Activity 保留，以及 Activity 成员和 Azure Bot OAuth 平台动作。
