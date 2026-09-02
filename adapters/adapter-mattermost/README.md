# @onebots/adapter-mattermost

Mattermost adapter for OneBots, built on REST API v4 and the official WebSocket protocol. It supports a standalone typed Client, reliable reconnection, externally owned sockets, and manual event ingress without opening another port.

## 特性

- 可嵌入 `MattermostClient`，统一提供 REST v4、`acceptSocket(socket)` 与 `ingest(rawEvent)`；
- 官方 `authentication_challenge`、`connection_id` / `sequence_number` 可靠续接、默认无限指数退避与 `AbortSignal`；
- post、thread、reaction、file、DM、GDM、team、channel、member、status、typing 与 scheduled posts；
- 完整 canonical message/notice/meta 投影，未知插件事件保留 `raw_event`；
- 结构化 Mattermost 错误、响应大小上限、严格外部 JSON 校验和受控相对路径 `call()`；
- 事件、Team 与 Channel 过滤在 Web 表单中动态增减，无需手写 JSON；
- 账号能力会随事件白名单、接收模式和已有 socket 状态动态收敛。

## Standalone client

```ts
import { MattermostClient } from "@onebots/adapter-mattermost";

const client = new MattermostClient({
  account_id: "support",
  server_url: "https://mattermost.example.com",
  access_token: process.env.MATTERMOST_TOKEN!,
  receive_mode: "manual",
});

client.on("event", delivery => dispatch(delivery));
await client.start();

// 已有连接管理器：
await client.acceptSocket(socket, { authenticate: false, owned: false });

// 或已有队列 / consumer：
await client.ingest(rawMattermostWebSocketEvent);
```

`call(method, path, options)` 只接受 `/api/v4` 下的相对路径，不能传绝对 URL 或越界路径。外部 socket 默认仍发送官方认证 challenge；只有宿主已通过连接头完成认证时才应设置 `authenticate: false`。`owned: false` 表示 `stop()` 只解绑监听器，不关闭宿主连接。

## English

The adapter keeps authentication, reliable WebSocket resume state, strict event parsing, filtering, deduplication, and canonical projection behind one Client. It does not emulate unsupported group membership semantics or start a private HTTP/WS listener. See the [Chinese platform guide](../../docs/src/platform/mattermost.md) or [English platform guide](../../docs/src/en/platform/mattermost.md).

Official references: [REST API](https://api.mattermost.com/), [WebSocket API](https://developers.mattermost.com/integrate/reference/websocket/), and [Bot Accounts](https://developers.mattermost.com/integrate/reference/bot-accounts/).
