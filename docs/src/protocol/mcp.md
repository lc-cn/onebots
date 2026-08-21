# MCP 协议

MCP (Model Context Protocol) 是由 Anthropic 发布的开放协议，用于标准化 AI Agent 与外部工具的交互。OneBots 通过 MCP 协议将 IM 平台的能力暴露为标准工具，让 Cursor、Claude Code、Cline 等 AI 编程助手可以直接操作消息、群组、好友等功能。

## 快速开始

只需三步即可让 AI Agent 接入你的 IM 平台：

**第一步：安装并配置**

```bash
npm install onebots @onebots/protocol-mcp-v1
```

在 `config.yaml` 中为账号启用 MCP 协议：

```yaml
qq.my-bot:
  appid: "your-appid"
  secret: "your-secret"
  mcp.v1: {}                    # 启用即可，所有选项都有默认值
```

**第二步：配置 AI Agent**

以 Cursor 为例，在 `~/.cursor/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "onebots": {
      "command": "npx",
      "args": ["onebots", "mcp", "--config", "/path/to/config.yaml", "--account", "qq/my-bot"]
    }
  }
}
```

**第三步：开始使用**

在 Cursor 中直接对 AI 说："帮我给群 123456 发一条消息"，AI 会自动调用 `send_message` 工具完成操作。

## 协议特性

- **AI Agent 原生**：专为 Cursor、Claude Code、Cline 等 AI 编程助手设计
- **标准化工具调用**：基于 JSON-RPC 2.0，符合 MCP 2025-03-26 规范
- **双传输模式**：stdio（本地直连）和 HTTP/SSE（远程访问）
- **安全控制**：Bearer Token 鉴权 + 工具白名单/黑名单

## 安装

```bash
# 服务端协议插件（必需）
npm install @onebots/protocol-mcp-v1

# 客户端 SDK（仅编程调用时需要，AI Agent 无需安装）
npm install @onebots/mcp-client
```

## 配置

### 基础配置

```yaml
qq.my-bot:
  appid: "xxx"
  secret: "xxx"
  mcp.v1: {}                    # 使用默认配置即可
```

### 完整配置

```yaml
# 全局默认（可选，所有账号共享）
general:
  mcp.v1:
    access_token: "your_token"
    tools_blacklist:
      - kick_group_member
      - delete_friend

# 账号级别（覆盖全局配置）
qq.my-bot:
  appid: "xxx"
  secret: "xxx"
  mcp.v1:
    access_token: "bot-specific-token"    # 访问令牌
    tools_whitelist: []                   # 工具白名单（留空 = 全部启用）
    tools_blacklist: []                   # 工具黑名单
```

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `access_token` | string | 无 | Bearer Token 鉴权，留空则不鉴权 |
| `tools_whitelist` | string[] | [] | 只暴露列表中的工具，留空表示全部启用 |
| `tools_blacklist` | string[] | [] | 隐藏列表中的工具 |

## 传输方式

MCP 提供两种传输方式，适用于不同场景：

### stdio（推荐）

通过 stdin/stdout 进行 JSON-RPC 通信。这是 Cursor、Claude Code 等 AI Agent 的标准连接方式，无需额外网络配置。

```bash
onebots mcp --config config.yaml --account qq/my-bot
```

::: tip 何时用 stdio
本地开发、Cursor/Claude Code/Cline 等桌面 AI Agent 直连时使用。Agent 会自动启动该命令并通过管道通信。
:::

### HTTP/SSE（远程）

OneBots 服务启动后自动暴露 HTTP 端点，适用于远程访问或 Web 客户端：

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/{platform}/{account_id}/mcp/v1/sse` | GET | 建立 SSE 长连接，接收事件推送 |
| `/{platform}/{account_id}/mcp/v1/message` | POST | 发送 JSON-RPC 请求 |

连接流程：客户端先 GET `/sse` 建立 SSE 连接 → 收到 `endpoint` 事件获取消息发送地址 → 通过 POST 发送 JSON-RPC 请求 → 响应和事件通过 SSE 推送。

::: tip 何时用 HTTP/SSE
服务部署在远程服务器、多个客户端共享同一实例、或需要通过 Web 访问时使用。
:::

## AI Agent 配置

各 AI Agent 的配置方式大同小异，核心都是指定 `onebots mcp` 命令及其参数：

::: code-group
```json [Cursor (~/.cursor/mcp.json)]
{
  "mcpServers": {
    "onebots": {
      "command": "npx",
      "args": ["onebots", "mcp", "--config", "/path/to/config.yaml", "--account", "qq/my-bot"]
    }
  }
}
```

```json [Claude Code (~/.claude/claude_code_config.json)]
{
  "mcpServers": {
    "onebots": {
      "command": "npx",
      "args": ["onebots", "mcp", "--config", "/path/to/config.yaml", "--account", "qq/my-bot"]
    }
  }
}
```

```json [Cline (VS Code 设置)]
{
  "cline.mcpServers": {
    "onebots": {
      "command": "npx",
      "args": ["onebots", "mcp", "--config", "/path/to/config.yaml", "--account", "qq/my-bot"]
    }
  }
}
```
:::

::: tip
如果全局安装了 onebots（`npm install -g onebots`），可以将 `"command"` 改为 `"onebots"`，并从 `args` 中移除 `"onebots"`。
:::

## 可用工具

MCP v1 暴露 32 个工具，按功能分为以下几类。每个工具都接受 JSON 参数并返回结构化结果。

### 查询类

只读操作，不会修改任何数据：

| 工具 | 说明 |
| --- | --- |
| `get_login_info` | 获取当前机器人账号信息（ID、昵称、头像） |
| `get_user_info` | 获取指定用户的信息 |
| `get_friend_list` | 获取好友列表 |
| `get_friend_info` | 获取指定好友的信息 |
| `get_group_list` | 获取群列表 |
| `get_group_info` | 获取指定群的信息 |
| `get_group_member_list` | 获取群成员列表 |
| `get_group_member_info` | 获取群成员详细信息 |
| `get_guild_list` | 获取已加入的频道列表 |
| `get_guild_info` | 获取频道详情 |
| `get_channel_list` | 获取子频道列表 |
| `get_channel_info` | 获取子频道详情 |
| `get_guild_member_info` | 获取频道成员信息 |
| `get_channel_member_list` | 获取子频道成员列表 |
| `get_message` | 获取一条消息的详情 |
| `get_supported_actions` | 获取当前平台支持的 API 列表 |
| `get_status` | 获取机器人运行状态 |
| `get_version` | 获取实现版本信息 |

### 操作类

会修改数据或触发动作，建议通过黑名单控制权限：

| 工具 | 说明 | 风险等级 |
| --- | --- | --- |
| `send_message` | 发送消息（群聊/私聊/频道） | 低 |
| `delete_message` | 撤回/删除消息 | 低 |
| `upload_file` | 上传文件（图片/视频/语音/文件） | 低 |
| `handle_friend_request` | 处理好友请求（同意/拒绝） | 中 |
| `handle_group_request` | 处理加群请求/邀请 | 中 |
| `set_group_name` | 设置群名称 | 中 |
| `set_group_card` | 设置群成员名片 | 中 |
| `set_group_admin` | 设置/取消群管理员 | 中 |
| `mute_group_member` | 禁言群成员 | 高 |
| `mute_group_all` | 全员禁言/解除 | 高 |
| `kick_group_member` | 踢出群成员 | 高 |
| `delete_friend` | 删除好友 | 高 |
| `leave_group` | 退出群组 | 高 |

### 工具过滤

通过白名单或黑名单控制 Agent 的权限范围：

```yaml
mcp.v1:
  # 方式一：白名单 — 只暴露指定工具（适合严格场景）
  tools_whitelist:
    - get_login_info
    - get_group_list
    - get_friend_list
    - send_message

  # 方式二：黑名单 — 禁止高风险操作（适合宽松场景）
  tools_blacklist:
    - kick_group_member
    - mute_group_member
    - mute_group_all
    - delete_friend
    - leave_group
```

::: warning
白名单和黑名单同时配置时，白名单优先生效，黑名单在白名单结果上再次过滤。
:::

## 事件推送

连接建立后，MCP 会实时推送平台事件。事件以 JSON-RPC 通知格式发送（无 `id` 字段）。

### 消息事件

当有人发送消息时推送：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/message",
  "params": {
    "platform": "qq",
    "account_id": "my-bot",
    "message_type": "group",
    "message_id": "123",
    "sender": { "id": "456", "name": "用户A" },
    "group": { "id": "789", "name": "测试群" },
    "raw_message": "Hello",
    "timestamp": 1700000000
  }
}
```

### 通知事件

群成员变更、好友请求等非消息事件：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/notice",
  "params": {
    "platform": "qq",
    "account_id": "my-bot",
    "notice_type": "group_member_increase",
    "user": { "id": "456", "name": "新成员" },
    "group": { "id": "789", "name": "测试群" },
    "timestamp": 1700000000
  }
}
```

## 客户端 SDK

如果需要编程方式接入（而非通过 AI Agent），可以使用客户端 SDK：

```bash
npm install @onebots/mcp-client
```

```typescript
import { McpStdioClient } from '@onebots/mcp-client';

const client = new McpStdioClient({
  command: 'onebots',
  args: ['mcp', '--config', 'config.yaml', '--account', 'qq/my-bot'],
});

await client.connect();

const tools = await client.listTools();
console.log('可用工具:', tools.map(t => t.name));

const result = await client.callTool('send_message', {
  scene_type: 'group',
  scene_id: '123456',
  message: 'Hello from MCP!',
});

await client.close();
```

更多 SDK 用法请参考 [客户端 SDK 指南](/guide/client-sdk#mcp-客户端)。

## 与其他协议的对比

OneBots 支持 5 种输出协议，各有适用场景：

| | MCP | OneBot V11/V12 | Satori | Milky |
| --- | --- | --- | --- | --- |
| **设计目的** | AI Agent 工具调用 | 通用 Bot 框架对接 | 跨平台统一协议 | 轻量级直连 |
| **底层协议** | JSON-RPC 2.0 | HTTP / WebSocket | WebSocket | HTTP / WebSocket |
| **传输方式** | stdio / HTTP+SSE | HTTP / WS / 反向WS | WebSocket | HTTP / WS |
| **消息格式** | 纯文本（适合 LLM） | CQ码 / 消息段数组 | HTML 元素 | 消息段数组 |
| **典型客户端** | Cursor, Claude Code | NoneBot2, Koishi | Koishi | 自定义应用 |
| **适合场景** | AI 自动化 | 成熟生态 | 现代化跨平台 | 简单直接 |

## 相关链接

- [协议配置参考](/config/protocol#mcp-model-context-protocol)
- [客户端 SDK 指南](/guide/client-sdk#mcp-客户端)
- [MCP 协议规范](https://modelcontextprotocol.io/)
