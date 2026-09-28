---
"onebots": patch
"@onebots/protocol-onebot-v11": patch
"@onebots/adapter-qq": patch
---

统一 OneBot v11 反向 WebSocket、Webhook 的 `X-Self-ID` 与事件 `self_id`，使客户端能够按机器人身份找到对应连接。QQ 回复段将客户端回传的安全整数消息 ID 字符串按数值映射还原为平台原始消息 ID，并拒绝超出安全整数范围的标识；同时补齐 Docker 构建所需的清理脚本。
