# @onebots/mcp-client

OneBots MCP v1 客户端 SDK。支持 stdio 和 SSE 两种传输方式。

## 安装

```bash
pnpm add @onebots/mcp-client
```

## 使用示例

### stdio 客户端

```ts
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
  message: 'Hello from MCP client!',
});
console.log(result);

await client.close();
```

### SSE 客户端

```ts
import { McpSseClient } from '@onebots/mcp-client';

const client = new McpSseClient({
  url: 'http://localhost:6727/qq/my-bot/mcp/v1',
  accessToken: 'your-token',
});

await client.connect();

client.on('notifications/message', (params) => {
  console.log('收到消息:', params);
});

const result = await client.callTool('get_group_list');
console.log(result);
```

## API

### `McpClient`（基类）

- `connect()` — 连接并初始化
- `close()` — 断开连接
- `listTools()` — 获取可用工具列表
- `callTool(name, args)` — 调用工具
- `ping()` — 心跳检测
- `listResources()` — 列出资源
- `listPrompts()` — 列出提示词
- `getServerInfo()` — 获取服务端信息
- `isConnected()` — 是否已连接

### 事件

- `notification` — 收到任意通知
- `notifications/message` — 收到消息通知
- `notifications/notice` — 收到事件通知
- `error` — 错误
- `close` — 连接关闭
- `stderr`（仅 stdio）— 子进程 stderr 输出
