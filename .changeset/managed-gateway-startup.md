---
"@onebots/core": patch
"onebots": patch
---

分开管理通道就绪与账号启动完成，使等待登录的账号不再阻塞网关管理握手；保留嵌入式 start 等待账号启动的语义。受管启动拒绝连接尚未就绪的 MCP、HTTP 与 WebSocket 协议，平台登录回调保持可用。
