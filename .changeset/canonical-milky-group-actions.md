---
"@onebots/core": patch
"@onebots/adapter-icqq": patch
"@onebots/adapter-discord": patch
"@onebots/protocol-milky-v1": patch
---

将 Milky 群管理动作收敛为独立的 canonical 翻译层，修正头像、管理员、全员禁言、精华与消息表态字段，并让 ICQQ 和 Discord 正确执行表态的添加与删除。
