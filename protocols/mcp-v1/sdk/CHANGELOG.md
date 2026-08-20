# @onebots/mcp-client

## 0.1.1

### Patch Changes

- f472ebf: 实现 MCP (Model Context Protocol) v1 协议（#217, #218）：

  **协议插件 `@onebots/protocol-mcp-v1`：**
  - JSON-RPC 2.0 协议核心，协议版本 2025-03-26
  - 双传输：HTTP/SSE + stdio
  - 32 个 MCP Tools 覆盖消息、好友、群组、频道、文件、系统全部 API
  - 工具白名单/黑名单过滤、Bearer Token 鉴权
  - 实时事件推送（消息 + 通知）

  **客户端 SDK `@onebots/mcp-client`：**
  - McpStdioClient — stdio 传输客户端（Cursor / Claude Code）
  - McpSseClient — SSE 传输客户端（Web / 远程）

  **CLI 命令：**
  - `onebots mcp --account platform/account_id` 以 stdio 模式启动 MCP 服务
