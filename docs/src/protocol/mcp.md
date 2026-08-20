# MCP 协议

MCP (Model Context Protocol) 是由 Anthropic 发布的开放协议，用于标准化 AI Agent 与外部工具和数据源的交互方式。

## 协议简介

MCP 协议的特点：

- 🤖 **AI Agent 原生**: 专为 Cursor、Claude Code、Cline 等 AI 编程助手设计
- 🔧 **标准化工具调用**: 通过 JSON-RPC 2.0 调用结构化工具
- 📡 **双传输**: 支持 stdio（本地）和 HTTP/SSE（远程）两种传输方式
- 🔐 **灵活鉴权**: Bearer Token 鉴权 + 工具白名单/黑名单

## 安装

### 服务端

```bash
npm install @onebots/protocol-mcp-v1
```

### 客户端 SDK

```bash
npm install @onebots/mcp-client
```

## 配置

在 `config.yaml` 中配置 MCP 协议：

```yaml
# 全局默认配置
general:
  mcp.v1:
    access_token: "your_token"   # 访问令牌（可选）
    tools_whitelist: []          # 工具白名单（留空 = 全部启用）
    tools_blacklist: []          # 工具黑名单

# 账号配置
qq.my-bot:
  appid: "xxx"
  secret: "xxx"
  mcp.v1:
    access_token: "my-secret-token"
```

## 传输方式

### stdio（推荐用于 AI Agent）

通过 stdin/stdout 进行 JSON-RPC 通信，无需额外网络配置，是 Cursor、Claude Code 等工具的标准连接方式。

```bash
onebots mcp --config config.yaml --account qq/my-bot
```

### HTTP/SSE（适用于远程连接）

启动 OneBots 后自动在 HTTP 路由上暴露：

- **SSE 连接**: `GET /{platform}/{account_id}/mcp/v1/sse`
- **消息端点**: `POST /{platform}/{account_id}/mcp/v1/message`

SSE 连接建立后，服务端会推送 `endpoint` 事件告知消息发送地址，客户端通过 POST 发送 JSON-RPC 请求。

## AI Agent 配置

### Cursor

在 `~/.cursor/mcp.json` 中配置：

```json
{
  "mcpServers": {
    "onebots": {
      "command": "npx",
      "args": [
        "onebots", "mcp",
        "--config", "/path/to/config.yaml",
        "--account", "qq/my-bot"
      ]
    }
  }
}
```

### Claude Code

在 `~/.claude/claude_code_config.json` 中配置：

```json
{
  "mcpServers": {
    "onebots": {
      "command": "npx",
      "args": [
        "onebots", "mcp",
        "--config", "/path/to/config.yaml",
        "--account", "qq/my-bot"
      ]
    }
  }
}
```

### Cline (VS Code)

在 VS Code 设置中配置：

```json
{
  "cline.mcpServers": {
    "onebots": {
      "command": "npx",
      "args": [
        "onebots", "mcp",
        "--config", "/path/to/config.yaml",
        "--account", "qq/my-bot"
      ]
    }
  }
}
```

::: tip
如果使用 pnpm 全局安装了 onebots，可以将 `"command": "npx"` 替换为 `"command": "onebots"`，并从 `args` 中移除 `"onebots"`。
:::

## 可用工具

MCP v1 暴露 32 个工具，覆盖 OneBots 的全部核心 API：

### 消息

| 工具 | 说明 |
| --- | --- |
| `send_message` | 发送消息到指定场景（群聊/私聊/频道/频道私信） |
| `delete_message` | 撤回/删除一条消息 |
| `get_message` | 获取一条消息的详情 |

### 用户

| 工具 | 说明 |
| --- | --- |
| `get_login_info` | 获取当前机器人账号信息 |
| `get_user_info` | 获取指定用户的信息 |

### 好友

| 工具 | 说明 |
| --- | --- |
| `get_friend_list` | 获取好友列表 |
| `get_friend_info` | 获取指定好友的信息 |
| `handle_friend_request` | 处理好友请求（同意/拒绝） |
| `delete_friend` | 删除好友 |

### 群组

| 工具 | 说明 |
| --- | --- |
| `get_group_list` | 获取群列表 |
| `get_group_info` | 获取指定群的信息 |
| `get_group_member_list` | 获取指定群的成员列表 |
| `get_group_member_info` | 获取群成员详细信息 |
| `set_group_name` | 设置群名称 |
| `leave_group` | 退出群组 |
| `kick_group_member` | 踢出群成员 |
| `mute_group_member` | 禁言群成员 |
| `mute_group_all` | 全员禁言/解除全员禁言 |
| `set_group_admin` | 设置/取消群管理员 |
| `set_group_card` | 设置群成员名片 |
| `handle_group_request` | 处理加群请求/邀请 |

### 频道

| 工具 | 说明 |
| --- | --- |
| `get_guild_list` | 获取已加入的频道列表 |
| `get_guild_info` | 获取频道详情 |
| `get_channel_list` | 获取子频道列表 |
| `get_channel_info` | 获取子频道详情 |
| `get_guild_member_info` | 获取频道成员信息 |
| `get_channel_member_list` | 获取子频道成员列表 |

### 文件

| 工具 | 说明 |
| --- | --- |
| `upload_file` | 上传文件（图片/视频/语音/文件） |

### 系统

| 工具 | 说明 |
| --- | --- |
| `get_supported_actions` | 获取当前平台支持的 API 列表 |
| `get_status` | 获取当前机器人运行状态 |
| `get_version` | 获取实现版本信息 |

## 工具过滤

通过白名单或黑名单控制 Agent 可以使用的工具：

```yaml
mcp.v1:
  # 只允许查询类操作
  tools_whitelist:
    - get_login_info
    - get_group_list
    - get_friend_list
    - get_status

  # 或者禁止危险操作
  tools_blacklist:
    - kick_group_member
    - mute_group_member
    - delete_friend
    - leave_group
```

## 客户端 SDK 使用

### stdio 客户端

```typescript
import { McpStdioClient } from '@onebots/mcp-client';

const client = new McpStdioClient({
  command: 'onebots',
  args: ['mcp', '--config', 'config.yaml', '--account', 'qq/my-bot'],
});

await client.connect();

// 列出可用工具
const tools = await client.listTools();
console.log('可用工具:', tools.map(t => t.name));

// 发送消息
const result = await client.callTool('send_message', {
  scene_type: 'group',
  scene_id: '123456',
  message: 'Hello from MCP!',
});
console.log(result);

// 获取群列表
const groups = await client.callTool('get_group_list');
console.log(groups);

await client.close();
```

### SSE 客户端

```typescript
import { McpSseClient } from '@onebots/mcp-client';

const client = new McpSseClient({
  url: 'http://localhost:6727/qq/my-bot/mcp/v1',
  accessToken: 'your-token',
});

await client.connect();

// 监听消息通知
client.on('notifications/message', (params) => {
  console.log('收到消息:', params);
});

// 调用工具
const groups = await client.callTool('get_group_list');
console.log(groups);

await client.close();
```

## 事件推送

MCP 协议会实时推送消息和通知事件：

### 消息事件 (`notifications/message`)

```json
{
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

### 通知事件 (`notifications/notice`)

```json
{
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

## 与其他协议的区别

| 特性 | MCP | OneBot V11/V12 | Satori | Milky |
| --- | --- | --- | --- | --- |
| 设计目的 | AI Agent 工具调用 | 通用 Bot 框架 | 跨平台 Bot | 轻量级 Bot |
| 通信协议 | JSON-RPC 2.0 | HTTP/WS | WebSocket | HTTP/WS |
| 传输方式 | stdio / SSE | HTTP/WS/反向WS | WebSocket | HTTP/WS |
| 消息格式 | 纯文本 | CQ码/消息段 | HTML元素 | 消息段 |
| 典型客户端 | Cursor, Claude Code | NoneBot, Koishi | Koishi | 自定义 |

## 相关链接

- [协议配置](/config/protocol)
- [客户端 SDK 指南](/guide/client-sdk)
- [MCP 协议规范](https://modelcontextprotocol.io/)
