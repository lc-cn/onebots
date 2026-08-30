---
"imhelper": patch
"@imhelper/onebot-v11": patch
"@imhelper/onebot-v12": patch
"@imhelper/satori-v1": patch
"@imhelper/milky-v1": patch
---

将协议 Adapter 的实体与消息查询统一为纯 DTO 边界，由 ImHelper 稳定缓存并投影成绑定当前 Client 的行为实例。补齐 OneBot 11/12 好友目录、OneBot 11 消息查询和 Satori 分页目录解析，协议数据结构错误不再伪装为空列表。
