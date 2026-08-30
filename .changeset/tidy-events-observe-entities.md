---
"imhelper": patch
"@imhelper/onebot-v12": patch
"@onebots/protocol-onebot-v12": patch
"@imhelper/satori-v1": patch
---

让 typed event 在交付前把已确认的用户、群、频道与成员身份写入稳定 identity map。事件实体 getter 不再依赖预先执行目录查询，后续 refresh 仍在同一实例上补全资料，且申请人不会被提前伪装成好友或成员。频道消息与实体新增显式 Guild 上下文，Satori 目录使用准确的 guild scope。OneBot 12 同时补齐频道目录与成员 API、频道双重寻址、可拒绝的好友/群申请动作，保留 opaque flag 与申请子类型，并让扩展邀请动作继续使用协议标准字符串 ID。
