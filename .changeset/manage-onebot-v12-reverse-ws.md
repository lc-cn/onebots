---
"@onebots/protocol-onebot-v12": patch
---

将反向 WebSocket 的连接、无限重连与停止生命周期封装为可释放会话，修复协议停止后旧连接仍会恢复的问题；同时在 connect 元事件中等待真实版本信息，避免把未解析 Promise 序列化为空对象。
