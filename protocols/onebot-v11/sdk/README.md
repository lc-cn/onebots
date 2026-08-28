# @imhelper/onebot-v11

OneBot V11 客户端 SDK。包内导出具体 `OneBotV11Client`、`OneBotV11Adapter`、对应 factory，以及完整的协议事件和响应类型。

## 安装

```bash
pnpm add imhelper @imhelper/onebot-v11
```

## 创建客户端

推荐直接使用 `createOnebot11Client()`：

```typescript
import { createOnebot11Client } from "@imhelper/onebot-v11";

const client = createOnebot11Client({
  // 事件连接地址；完整 OneBots 路由也可以直接放在这里。
  baseUrl: "http://localhost:6700/onebot/v11",
  // API 地址可与事件地址不同；不设置时使用 baseUrl。
  apiBaseUrl: "http://localhost:6700/onebot/v11",
  selfId: "123456789",
  accessToken: "your-token",
  receiveMode: "ws",
});

client.on("event", event => {
  // event 的类型是 OneBotV11Event，不是 unknown。
  if (event.post_type === "message") {
    // 处理 OneBot 原始事件
  }
});

client.on("message.private", async message => {
  await message.reply("收到");
});

await client.start();
```

也可以显式构造，或只创建 adapter：

```typescript
import { OneBotV11Client, createOnebot11Adapter } from "@imhelper/onebot-v11";
import { createImHelper } from "imhelper";

const directClient = new OneBotV11Client(config);
const adapter = createOnebot11Adapter(config);
const genericClient = createImHelper(adapter);

// genericClient.adapter 仍保留 OneBotV11Adapter 具体类型。
await genericClient.adapter.call("get_login_info");
```

## API 调用

```typescript
const result = await client.call<{ user_id: number; nickname: string }>("get_login_info");

await client.sendPrivateMessage(123456789, "你好");
await client.sendGroupMessage(987654321, "大家好");
await client.inviteFriendToGroup(987654321, 123456789);
await client.acceptFriendRequest("opaque-flag-from-request-event", "已验证");
```

`acceptFriendRequest()` 的 `flag` 必须原样取自 `request.friend` 事件，不能传好友 QQ 号。

`baseUrl` 是完整的协议服务地址，SDK 不会根据平台或账号猜测 OneBots 路由。未提供 `apiBaseUrl` 时，API 与 WebSocket 共用 `baseUrl`；分离部署时显式传入 `apiBaseUrl` 和 `wsUrl`。

特殊部署可注入 URL 解析器或整个调用实现：

```typescript
const client = createOnebot11Client({
  baseUrl: "ws://events.example/onebot/v11",
  apiBaseUrl: "https://api.example",
  selfId: "123456789",
  receiveMode: "ws",
  resolveActionUrl: action => `https://gateway.example/actions/${action}`,
  // 也可传入 call(action, params)，完全接管 HTTP 调用。
});
```

宿主已经管理 HTTP/WS 连接时可设置 `receiveMode: "manual"`，再调用 `ingest()`、`acceptHttp()` 或 `acceptWebSocket()`；此模式不会自行连接或监听端口。协议调用失败会抛出带 `protocol`、`operation`、`kind` 和 HTTP 状态等字段的 `ProtocolError`。

## WebSocket 恢复策略

`ws` 默认无限重连。可以通过 `webSocket` 配置 AbortSignal、退避和日志：

```typescript
const controller = new AbortController();

const client = createOnebot11Client({
  baseUrl: "ws://localhost:6700/onebot/v11",
  selfId: "123456789",
  receiveMode: "ws",
  webSocket: {
    signal: controller.signal,
    reconnect: {
      initialDelayMs: 1000,
      maxDelayMs: 30_000,
      factor: 2,
    },
    logger,
  },
});

controller.abort();
```

## 接入已有宿主

继承自 `ImHelper` 的入口均可直接使用，不需要 SDK 另开端口：

```typescript
client.ingest(oneBotEvent);
await client.acceptHttp(request, response);
const detach = client.acceptWebSocket(upgradedSocket);
```

## 实际导出

- `OneBotV11Client` / `createOnebot11Client()`
- `OneBotV11Adapter` / `createOnebot11Adapter()`
- `OneBotV11Event`
- `OneBotV11Response<T>`
- `OneBotV11AdapterConfig`
- `OneBotV11ActionUrlResolver` / `OneBotV11Call`

许可证：MIT
