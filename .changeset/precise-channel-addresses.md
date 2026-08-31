---
"@onebots/core": patch
"@onebots/protocol-onebot-v12": patch
"@onebots/protocol-satori-v1": patch
"@onebots/adapter-qq": patch
"@onebots/adapter-discord": patch
"@onebots/adapter-kook": patch
"@onebots/adapter-slack": patch
"@onebots/adapter-teams": patch
"@onebots/adapter-heychat": patch
---

统一保留频道事件的服务器与频道双层地址，修正 OneBot V12 和 Satori 的频道事件投影，并让 OneBot V12 发送使用独立的 `guild_id` 与 `channel_id`。
