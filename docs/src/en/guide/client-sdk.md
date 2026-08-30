# Client SDK Guide

OneBots provides two client families. `imhelper` is for event-driven bot applications, while `@onebots/mcp-client` is for AI agents and automation through MCP tool calls.

## imhelper

Install the core package and one protocol package:

```bash
pnpm add imhelper @imhelper/onebot-v12
```

| Protocol | Package | Client factory |
| --- | --- | --- |
| OneBot 11 | `@imhelper/onebot-v11` | `createOnebot11Client()` |
| OneBot 12 | `@imhelper/onebot-v12` | `createOnebot12Client()` |
| Milky | `@imhelper/milky-v1` | `createMilkyClient()` |
| Satori | `@imhelper/satori-v1` | `createSatoriClient()` |

Each factory returns a concrete Client with typed protocol events, adapter methods, and native `call()` signatures. The removed `registerAdapter()` and `connect()` APIs are not part of the current SDK.

### Create a client

`baseUrl` is the complete account protocol root. The SDK never guesses a OneBots gateway path from `platform` or `selfId`.

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

client.on('message.group', async message => {
  await message.reply('Received!');
});

await client.start();
```

Call `await client.stop()` during shutdown. Set `apiBaseUrl` only when events and actions use different roots.

### Events, entities, and actions

Typed events include `message.private`, `message.group`, `message.channel`, `notice.*`, `request.*`, `meta.*`, and the protocol-native `event` stream.

```typescript
await client.sendPrivateMessage('user-id', 'Hello');
await client.sendGroupMessage('group-id', 'Hello group');

const group = await client.getGroupInfo('group-id');
const members = await client.getGroupMemberList('group-id');
await group.sendMessage('Bound entity message');
await members[0].refresh();
```

Guild channels require explicit parent context:

```typescript
const channels = await client.getChannelList({
  scope: { type: 'guild', id: 'guild-id' },
});

await client.sendChannelMessage('channel-id', 'Hello channel', 'guild-id');
```

OneBot and Milky clients expose `call(action, params)`. Satori exposes `call(resource, method, params)`. Transport and protocol failures throw structured `ProtocolError` values.

### Receive modes

| Mode | Behavior | Start |
| --- | --- | --- |
| `ws` | Connect to a forward WebSocket | `client.start()` |
| `sse` | Connect to an SSE stream | `client.start()` |
| `wss` | Listen for reverse WebSocket connections | `client.start(port)` |
| `webhook` | Listen for HTTP webhooks | `client.start(port)` |
| `manual` | Create no connection or listener | Use host ingress methods |

WebSocket reconnects are unlimited by default. Configure cancellation, backoff, jitter, and logging through `webSocket`.

### Existing hosts

Use `manual` when your application already owns its HTTP server, upgraded WebSocket, queue, or framework connection.

```typescript
const manual = createOnebot12Client({
  baseUrl: 'http://localhost:6727/qq/my-bot/onebot/v12',
  selfId: 'my-bot',
  receiveMode: 'manual',
});

manual.ingest(rawEvent);
const result = await manual.acceptHttp(request);
const detach = manual.acceptWebSocket(upgradedSocket);
```

`acceptHttp(request, response)` writes a Node.js response. Omitting `response` returns structured `{ status, headers, body }` data. `acceptWebSocket()` accepts an already upgraded socket and returns a detach function.

## MCP client

`@onebots/mcp-client` uses JSON-RPC tool calls rather than imhelper events. AI tools that launch `onebots mcp` directly do not need this package.

```typescript
import { McpStdioClient } from '@onebots/mcp-client';

const client = new McpStdioClient({
  command: 'onebots',
  args: ['mcp', '--config', 'config.yaml', '--account', 'qq/my-bot'],
});

await client.connect();
const result = await client.callTool('send_message', {
  scene_type: 'group',
  scene_id: 'group-id',
  message: 'Hello from MCP!',
});
await client.close();
```

See the [MCP protocol guide](/en/protocol/mcp) for remote transports and the complete API.
