---
"@onebots/protocol-onebot-v11": patch
"@onebots/adapter-teams": patch
---

修复 OneBot V11 出站 at 消息段缺少 `qq` 字段的问题：抖音、钉钉、Discord、飞书、Telegram 等只给出 `user_id` / `id` 的适配器，现在会在协议层补齐 `qq`（通用 ID 的数字形式，或 `all`；LINE 的 `self` 映射为机器人自身 ID），AstrBot 等严格遵循 V11 的框架可以正常解析 @。

Teams 适配器在 `<at>` 没有对应 mention 实体时改为输出 `@名字` 文本，不再把显示名当作用户 ID。
