# 客户端 SDK 使用指南

OneBots 提供两类客户端：`imhelper` 面向事件驱动的机器人业务，`@onebots/mcp-client` 面向 AI Agent 和自动化工具调用。两者连接同一网关，但协议模型不同。

| 客户端 | 适用场景 | 协议 |
| --- | --- | --- |
| `imhelper` | 机器人框架、业务服务、事件消费 | OneBot 11/12、Milky、Satori |
| `@onebots/mcp-client` | AI Agent、自动化脚本 | MCP |

## imhelper

### 安装并选择协议

安装核心包和一个协议包：

```bash
pnpm add imhelper @imhelper/onebot-v12
```

| 协议 | 包 | Client factory |
| --- | --- | --- |
| OneBot 11 | `@imhelper/onebot-v11` | `createOnebot11Client()` |
| OneBot 12 | `@imhelper/onebot-v12` | `createOnebot12Client()` |
| Milky | `@imhelper/milky-v1` | `createMilkyClient()` |
| Satori | `@imhelper/satori-v1` | `createSatoriClient()` |

具体 factory 返回保留协议 Adapter、原始事件和 `call()` 类型的 Client。应用代码通常无需先创建 Adapter，也无需调用已移除的 `registerAdapter()` 或 `connect()`。

### 创建 Client

`baseUrl` 是完整的账号协议根地址。SDK 不会根据 `platform`、`selfId` 或其他字段猜测 OneBots 网关布局。

```typescript
import { createOnebot12Client } from '@imhelper/onebot-v12';

const client = createOnebot12Client({
  baseUrl: 'http://localhost:6727/qq/my-bot/onebot/v12',
  apiBaseUrl: 'http://localhost:6727/qq/my-bot/onebot/v12',
  wsUrl: 'ws://localhost:6727/qq/my-bot/onebot/v12',
  selfId: 'my-bot',
  accessToken: 'your-token',
  receiveMode: 'ws',
});

client.on('message.private', async message => {
  await message.reply('收到！');
});

client.on('message.group', async message => {
  console.log(message.sender.user_id, message.content);
});

await client.start();
```

应用退出时调用 `await client.stop()`。并发 `start()` / `stop()` 由当前 Adapter 的生命周期实现负责。

### API 地址与自定义调用

`apiBaseUrl` 仅在事件和 API 部署在不同地址时设置。OneBot action 追加到 API 根地址，Milky 使用 `/api/{action}`，Satori 使用 `/{resource}.{method}`。

```typescript
const status = await client.call('get_status');
await client.sendPrivateMessage('user-id', '你好');
await client.sendGroupMessage('group-id', '大家好');
```

特殊部署可使用 `resolveActionUrl` 改写动作 URL，或注入 `call` 完全接管协议请求。HTTP、协议或平台错误会以结构化 `ProtocolError` 抛出。

Satori 的原生调用使用资源和方法两个参数：

```typescript
import { createSatoriClient } from '@imhelper/satori-v1';

const satori = createSatoriClient({
  baseUrl: 'http://localhost:6727/discord/my-bot/satori/v1',
  selfId: 'my-bot',
  platform: 'discord',
  accessToken: 'your-token',
  receiveMode: 'manual',
});

await satori.call('guild', 'list', {});
```

### 事件与实体

Client 提供类型化事件：

- `message.private`、`message.group`、`message.channel`
- `notice.*`、`request.*`、`meta.*`
- `event`：当前协议的原始事件

查询 API 会把 DTO 投影为绑定当前 Client 的实体。同一实体刷新后保持对象身份，已有引用会看到最新资料。

```typescript
const users = await client.getUserList();
const groups = await client.getGroupList();
const group = await client.getGroupInfo('group-id');
const members = await client.getGroupMemberList('group-id');

await users[0].sendMessage('你好');
await group.sendMessage('群消息');
await members[0].refresh();
```

`pickUser()`、`pickGroup()` 和 `pickChannel()` 只选择已经由事件或查询写入缓存的实体，不发起网络请求。

频道属于 Guild 时必须显式提供父级上下文：

```typescript
const channels = await client.getChannelList({
  scope: { type: 'guild', id: 'guild-id' },
});

await client.sendChannelMessage('channel-id', '频道消息', 'guild-id');
await channels[0].sendMessage('频道消息');
```

### 接收模式

`receiveMode` 支持 `ws`、`sse`、`wss`、`webhook` 和 `manual`。

| 模式 | 行为 | 启动方式 |
| --- | --- | --- |
| `ws` | 主动连接正向 WebSocket | `client.start()` |
| `sse` | 主动连接 SSE | `client.start()` |
| `wss` | 独立监听反向 WebSocket | `client.start(port)` |
| `webhook` | 独立监听 HTTP Webhook | `client.start(port)` |
| `manual` | 不创建连接或端口 | 由宿主调用接入方法 |

WebSocket 默认无限重连。可通过 `webSocket` 配置 `AbortSignal`、退避、随机抖动和 logger。

### 接入已有 Host

已有 HTTP 服务、反向 WebSocket、队列或框架连接应使用 `manual`。所有入口最终交给同一个 Client，不需要 SDK 再开端口。

```typescript
const manual = createOnebot12Client({
  baseUrl: 'http://localhost:6727/qq/my-bot/onebot/v12',
  selfId: 'my-bot',
  receiveMode: 'manual',
});

manual.ingest(rawEvent);
```

Node.js HTTP Host 可以直接传入 request/response：

```typescript
import { createServer } from 'node:http';

createServer(async (request, response) => {
  if (request.url === '/events') {
    await manual.acceptHttp(request, response);
    return;
  }
  response.writeHead(404).end();
}).listen(8080);
```

宿主希望自行写响应时省略第二个参数，使用 `{ status, headers, body }` 结构化结果。路由与鉴权仍由宿主负责。

已完成 Upgrade 的 WebSocket 可直接交付：

```typescript
webSocketServer.on('connection', socket => {
  const detach = manual.acceptWebSocket(socket);
  socket.once('close', detach);
});
```

### 请求和文件

通用入口包括：

- 用户、好友、群组、成员、Guild 和 Channel 目录
- `getMessage()`、`uploadFile()`、`getFile()`
- `approveFriendRequest()`、`approveGroupRequest()`
- 消息实体的 `reply()`、`recall()`、`edit()` 与 reaction 动作

协议不支持的可选动作会抛出 `UnsupportedAdapterOperationError`，不会用空数组或伪成功结果掩盖能力缺失。

## MCP 客户端

`@onebots/mcp-client` 通过 JSON-RPC 主动调用工具，独立于 imhelper 的事件模型。Cursor、Claude Code 等 Agent 通常直接连接 `onebots mcp`，无需安装此包。

```bash
pnpm add @onebots/mcp-client
```

```typescript
import { McpStdioClient } from '@onebots/mcp-client';

const client = new McpStdioClient({
  command: 'onebots',
  args: ['mcp', '--config', 'config.yaml', '--account', 'qq/my-bot'],
});

await client.connect();
const tools = await client.listTools();
const result = await client.callTool('send_message', {
  scene_type: 'group',
  scene_id: 'group-id',
  message: 'Hello from MCP!',
});
await client.close();
```

远程服务使用 `McpSseClient`。完整说明见 [MCP 协议](/protocol/mcp)。

## 下一步

- [OneBot 11](/protocol/onebot-v11)
- [OneBot 12](/protocol/onebot-v12)
- [Milky](/protocol/milky)
- [Satori](/protocol/satori)
- [适配器开发指南](/guide/adapter)
