---
"@onebots/adapter-qq": patch
---

修复 QQ `upload_file` 返回不可发送的 UUID：现在返回可供 `msg_type: 7` 复用的目标会话媒体句柄，并支持在消息段中通过 `file_id`/`file_info` 直接发送及还原统一回复 ID。
