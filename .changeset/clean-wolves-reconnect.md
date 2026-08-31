---
"@onebots/core": patch
"onebots": patch
"@onebots/protocol-onebot-v11": patch
"@onebots/protocol-onebot-v12": patch
"@onebots/protocol-milky-v1": patch
---

统一反向 WebSocket 的无限重连与停止生命周期，避免协议停止后遗留连接或定时器重新拉起。

修正 OneBot 11 仅配置反向 WebSocket 时不发送心跳的问题，并防止 OneBot 11、Milky 重连后丢失事件派发监听。
