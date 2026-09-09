---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-icqq": patch
"@onebots/protocol-onebot-v11": patch
---

修复 ICQQ 配置中的数字 QQ 号在事件 `bot_id` 与 OneBot v11 `self_id` 中被当成字符串并生成随机统一 ID；账号身份现在先恢复为平台数字类型，其他平台的原生字符串账号仍保留字符串映射语义。
