---
"@imhelper/satori-v1": major
"@onebots/protocol-satori-v1": patch
---

对齐 Satori 1.3：`friend.list` 按 Friend 资源解析，表态接口改用 `emoji_id`，回复消息原样回传 `referrer`，支持 `<emoji>` 与 guild-emoji 事件，并将 `GuildMember.roles` 定为 `GuildRole[]`。`reaction.create` / `reaction.delete` 不再发送旧字段 `emoji`。Satori 服务端同时接受官方 `emoji_id`，并继续接受旧字段 `emoji`。
