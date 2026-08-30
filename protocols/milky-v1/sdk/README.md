# @imhelper/milky-v1

Milky v1 客户端 SDK。包内导出具体 `MilkyV1Client`、`MilkyV1Adapter`、对应 factory、原始事件与响应类型。

## 安装

```bash
pnpm add imhelper @imhelper/milky-v1
```

## 创建客户端

```typescript
import { createMilkyClient } from "@imhelper/milky-v1";

const client = createMilkyClient({
  baseUrl: "http://localhost:6727/icqq/10001/milky/v1",
  apiBaseUrl: "http://localhost:6727/icqq/10001/milky/v1",
  wsUrl: "ws://localhost:6727/icqq/10001/milky/v1/event",
  selfId: "10001",
  accessToken: "your-token",
  receiveMode: "ws",
});

client.on("message.group", async message => {
  await message.reply("收到");
});

client.on("event", event => {
  if (event.event_type === "message_receive") {
    console.log(event.data);
  }
});

await client.start();
```

`baseUrl` 是完整协议根，SDK 不会猜测 OneBots 的平台或账号路径。事件地址默认追加 `/event`；API 动作始终发送到 `/api/{action}`。分离部署时可设置 `apiBaseUrl`、`wsUrl` 或 `resolveActionUrl`，也可注入 `call` 完全接管请求。

## API 与实体

```typescript
const status = await client.call("get_status");
await client.sendPrivateMessage("123456789", "你好");
await client.sendGroupMessage("987654321", "大家好");
await client.inviteFriendToGroup("987654321", "123456789");

const friends = await client.getUserList();
const group = await client.getGroupInfo("987654321");
const members = await client.getGroupMemberList("987654321");
await friends[0].sendMessage("你好");
await group.sendMessage("群消息");
await members[0].refresh();
```

好友和群申请事件会保存 Milky 要求的 opaque 上下文。优先调用事件的 `approve()` / `reject()`，或把事件提供的 `request_id` 原样交给 `approveFriendRequest()`、`approveGroupRequest()`。

## 接入已有宿主

宿主自行管理 HTTP、反向 WebSocket 或其他连接时，使用 `receiveMode: "manual"`。SDK 不会创建连接或监听端口：

```typescript
client.ingest(milkyEvent);
await client.acceptHttp(request, response);
const detach = client.acceptWebSocket(upgradedSocket);
```

省略 `acceptHttp` 的 `response` 参数可获得 `{ status, headers, body }` 结构化响应。`acceptWebSocket()` 接收已完成 Upgrade 的 socket，并返回解除监听的函数。

## 运行时契约

- 原始事件使用 `event_type`，消息接收事件为 `message_receive`。
- 消息场景来自 `data.message_scene`，支持 `friend`、`group` 和 `temp`。
- 主动 WebSocket 默认无限重连，可通过 `webSocket` 配置 `AbortSignal`、退避、抖动和 logger。
- HTTP、响应结构和 Milky 错误会抛出带协议上下文的 `ProtocolError`。
- 未实现的可选能力会抛出 `UnsupportedAdapterOperationError`，不会返回伪造的空结果。

## 实际导出

- `MilkyV1Client` / `createMilkyClient()`
- `MilkyV1Adapter` / `createMilkyAdapter()`
- `MilkyV1Event` / `MilkyV1Response<T>`
- `MilkyAdapterConfig`
- `MilkyActionUrlResolver` / `MilkyCall`
- `ProtocolError`

许可证：MIT
