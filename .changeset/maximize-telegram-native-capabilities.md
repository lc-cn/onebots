---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-telegram": patch
"@onebots/protocol-onebot-v11": patch
"@onebots/protocol-onebot-v12": patch
"@onebots/protocol-milky-v1": patch
"@onebots/protocol-satori-v1": patch
---

新增能力清单白名单保护的平台扩展动作调用链，并让四种协议可调用适配器声明的扩展动作。Telegram 适配器补齐群管理、入群申请、文件、投票、转发、Reaction、置顶和邀请链接等原生能力，将完整 Update 统一投影且保留 raw_event。
