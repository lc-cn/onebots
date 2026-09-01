---
"@onebots/protocol-mcp-v1": patch
"onebots": patch
---

让 MCP stdio 串行处理请求、将异步失败转换为 JSON-RPC 内部错误，并在输入关闭时等待队列后只清理一次。
