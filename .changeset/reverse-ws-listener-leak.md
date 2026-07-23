---
"@onebots/protocol-onebot-v12": patch
"@onebots/protocol-onebot-v11": patch
"@onebots/protocol-milky-v1": patch
---

修复反向 WebSocket 断线重连时 `dispatch` 事件监听器泄漏的问题：每次重连都会新增监听且旧监听不移除，多个监听器共享同一个 `ws` 闭包变量，导致重连成功后 connect/heartbeat/消息等事件被重复发送 N 次（N=重连次数）。现已在连接关闭时移除对应监听器。
