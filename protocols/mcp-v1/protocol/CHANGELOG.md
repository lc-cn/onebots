# @onebots/protocol-mcp-v1

## 0.1.5

### Patch Changes

- c9e876c: 建立统一的 Adapter 能力清单与结构化能力错误，修复 Teams、Mock 和企业微信事件投递，并复用微信生态回调验签、解密与 XML 解析实现。
- 78c1e50: 统一 SDK 地址语义并移除隐式 OneBots 路由兼容逻辑；为协议 Schema 增加事件过滤器元数据，在 Web 配置页提供可增删的可视化规则编辑器与高级 JSON 模式。
- Updated dependencies [9cc0622]
- Updated dependencies [c9e876c]
- Updated dependencies [a87f07a]
- Updated dependencies [f1493f6]
- Updated dependencies [78c1e50]
- Updated dependencies [03cc74d]
  - onebots@1.2.8

## 0.1.4

### Patch Changes

- onebots@1.2.7

## 0.1.3

### Patch Changes

- Updated dependencies [7891a2e]
  - onebots@1.2.6

## 0.1.2

### Patch Changes

- 41f4bcc: 改进 Web 配置、日志与验证管理，补充 MCP 和协议格式测试，并收紧核心、适配器及协议实现的公开类型。四个客户端 SDK 的事件扩展字段和默认响应数据由 `any` 收紧为 `unknown`，调用方需先进行类型收窄。
- Updated dependencies [41f4bcc]
  - onebots@1.2.5

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

- Updated dependencies [f472ebf]
  - onebots@1.2.4
