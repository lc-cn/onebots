# @onebots/mcp-client

OneBots MCP v1 客户端 SDK — 通过编程方式连接 OneBots MCP 服务。

> 如果你使用 Cursor / Claude Code / Cline 等 AI Agent，不需要安装此包。Agent 会通过 stdio 直接与 `onebots mcp` 命令通信。此 SDK 用于自己编写代码调用 MCP 工具的场景。

## 安装

```bash
pnpm add @onebots/mcp-client
# 或
npm install @onebots/mcp-client
```

## 快速开始

### stdio 客户端

适用于本地连接，自动管理 OneBots 子进程：

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

// 发送群消息
const result = await client.callTool('send_message', {
  scene_type: 'group',
  scene_id: '123456',
  message: 'Hello from MCP client!',
});
console.log(result);

await client.close();
```

### SSE 客户端

适用于连接远程运行中的 OneBots 服务：

```typescript
import { McpSseClient } from '@onebots/mcp-client';

const client = new McpSseClient({
  url: 'http://localhost:6727/qq/my-bot/mcp/v1',
  accessToken: 'your-token',  // 可选，与服务端 access_token 一致
});

await client.connect();

// 监听实时消息
client.on('notifications/message', (params) => {
  console.log('收到消息:', params);
});

// 查询群列表
const groups = await client.callTool('get_group_list');
console.log(groups);

await client.close();
```

## API

### McpClient（基类）

| 方法 | 说明 |
| --- | --- |
| `connect()` | 连接并完成 MCP 握手 |
| `close()` | 断开连接 |
| `listTools()` | 获取可用工具列表 |
| `callTool(name, args)` | 调用工具并返回结果 |
| `ping()` | 心跳检测 |
| `listResources()` | 列出资源 |
| `listPrompts()` | 列出提示词 |
| `getServerInfo()` | 获取服务端信息 |
| `isConnected()` | 是否已完成握手 |

### 事件

| 事件 | 说明 |
| --- | --- |
| `notification` | 收到任意 JSON-RPC 通知 |
| `notifications/message` | 收到消息推送 |
| `notifications/notice` | 收到通知推送（成员变更、请求等） |
| `error` | 连接或通信错误 |
| `close` | 连接关闭 |
| `stderr`（仅 stdio） | 子进程 stderr 输出 |
