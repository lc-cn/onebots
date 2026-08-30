# @imhelper/onebot-v12

OneBot V12 客户端 SDK。包内导出具体 `OneBotV12Client`、`OneBotV12Adapter`、对应 factory，以及协议事件和响应类型。

## 安装

```bash
pnpm add imhelper @imhelper/onebot-v12
```

## 创建客户端

```typescript
import { createOnebot12Client } from "@imhelper/onebot-v12";

const client = createOnebot12Client({
  // 完整协议根地址；SDK 不会猜测平台或账号路由。
  baseUrl: "http://localhost:6727/qq/bot/onebot/v12",
  apiBaseUrl: "http://localhost:6727/qq/bot/onebot/v12",
  selfId: "bot",
  accessToken: "your-token",
  receiveMode: "ws",
});

client.on("message.group", async event => {
  // sender/group/member 在事件交付前已经绑定，可立即执行实体行为。
  await event.reply(`收到，${event.sender.user_name ?? event.sender.user_id}`);
});

client.on("request.group", async event => {
  // opaque flag 与 add/invite 子类型由 SDK 保存并回传。
  await event.approve();
});

await client.start();
```

## API 与手动接入

```typescript
const status = await client.call("get_status");
await client.sendPrivateMessage("user-id", "你好");
await client.inviteFriendToGroup("group-id", "user-id");
await client.acceptFriendRequest("opaque-flag", "已验证");

// 好友与群请求事件也可通过统一 ImHelper 方法处理；支持同意和拒绝。
await client.approveFriendRequest("request-id", false, "拒绝理由");
await client.approveGroupRequest("request-id", true);
```

宿主自行管理 HTTP 或 WebSocket 时使用 `receiveMode: "manual"`，再调用 `ingest()`、`acceptHttp()` 或 `acceptWebSocket()`；SDK 不会另开端口。`baseUrl`、`apiBaseUrl`、`wsUrl`、`resolveActionUrl` 和可注入的 `call` 允许事件与 API 独立部署。

协议错误会抛出结构化 `ProtocolError`。WebSocket 默认无限重连，也可通过 `webSocket` 配置 `AbortSignal`、退避和 logger。

## 实际导出

- `OneBotV12Client` / `createOnebot12Client()`
- `OneBotV12Adapter` / `createOnebot12Adapter()`
- `OneBotV12Event` / `OneBotV12Response<T>`
- `OneBotV12AdapterConfig`
- `OneBotV12ActionUrlResolver` / `OneBotV12Call`
- `ProtocolError`

许可证：MIT
