# imhelper

`imhelper` 是 OneBots 客户端 SDK 的公共核心。它提供统一的 `ImHelper` 客户端、消息与事件模型；具体协议由 `@imhelper/onebot-v11`、`@imhelper/onebot-v12`、`@imhelper/satori-v1` 和 `@imhelper/milky-v1` 提供。

## 安装

安装核心包和所需的协议适配器：

```bash
pnpm add imhelper @imhelper/onebot-v11
```

## 创建客户端

```typescript
import { createOnebot11Client } from "@imhelper/onebot-v11";

const client = createOnebot11Client({
  baseUrl: "http://localhost:6727/kook/zhin/onebot/v11",
  apiBaseUrl: "http://localhost:6727/kook/zhin/onebot/v11",
  selfId: "10001",
  accessToken: "your_token",
  receiveMode: "ws",
});

client.on("message.private", async message => {
  await message.reply("收到！");
});

await client.start();
```

`receiveMode` 支持 `ws`、`wss`、`webhook`、`sse` 和 `manual`。`manual` 不创建连接或监听端口，仅通过 `ingest()`、`acceptHttp()` 或 `acceptWebSocket()` 接收宿主交付的事件。其他模式调用 `start()` 后由协议适配器建立连接；`webhook` 与 `wss` 模式会启动 HTTP 服务，可向 `start(port)` 传入端口。结束时调用 `client.stop()`。

HTTP 传输或协议调用失败会抛出 `ProtocolError`，其中包含 `protocol`、`operation`、`kind`、`httpStatus`、`code` 和原始 `response/cause` 等结构化上下文。

协议适配器未实现的可选 API 会拒绝并抛出 `UnsupportedAdapterOperationError`，其 `code` 为 `IMHELPER_ADAPTER_OPERATION_UNSUPPORTED`，`operation` 指向具体方法。目录 API 不会再用空数组伪装成平台返回了空目录。

四个协议包均导出具体 Client 和 factory：

- `OneBotV11Client` / `createOnebot11Client()`
- `OneBotV12Client` / `createOnebot12Client()`
- `SatoriV1Client` / `createSatoriClient()`
- `MilkyV1Client` / `createMilkyClient()`

具体 Client 会保留协议 adapter、原始事件和 `call()` 的完整类型。`client.adapter` 不再被擦除为基础 `Adapter`，`client.on("event", event => ...)` 也会推断出对应协议事件。

## 接入已有宿主

如果应用已经有 HTTP 服务或 WebSocket 连接，不需要调用 `start()`，也不需要让 SDK 另开端口。所有入口最终都调用同一个 `client.ingest(rawEvent)`，因此 HTTP、反向 WebSocket 和应用已有连接可以共享一个客户端及其事件监听器。

### 原始事件

```typescript
client.ingest(rawEvent);
```

`ingest(rawEvent)` 将协议原始事件交给当前适配器转换，并从同一个 `ImHelper` 实例触发标准事件。

### 已有 HTTP 服务

Node.js HTTP 服务可直接把 request/response 交给客户端：

```typescript
import { createServer } from "node:http";

const server = createServer(async (request, response) => {
  if (request.url === "/onebots/events") {
    await client.acceptHttp(request, response);
    return;
  }

  response.writeHead(404).end();
});
```

框架希望自行写响应时，可以省略第二个参数并使用结构化结果：

```typescript
const result = await client.acceptHttp(request);

// result:
// {
//   status: 200,
//   headers: { 'content-type': 'application/json; charset=utf-8' },
//   body: { status: 'ok' }
// }
```

`acceptHttp` 接受 POST JSON，包括 Node.js 请求流、Web 标准 `Request`，以及宿主已解析的 `body`。成功返回 200，无效 JSON 返回 400，超过默认 1 MiB 上限返回 413，非 POST 请求返回 405，事件转换失败返回 500。路由与鉴权仍由现有 HTTP 宿主负责。

### 已升级的 WebSocket

WebSocket 的 HTTP Upgrade 由宿主完成，再把已连接的 socket 交给客户端：

```typescript
webSocketServer.on("connection", socket => {
  const detach = client.acceptWebSocket(socket);

  socket.once("close", detach);
});
```

客户端监听 socket 的 JSON 文本或二进制 `message`。返回的 `detach()` 用于解除监听；无效载荷会以状态码 1007 关闭 socket，超过默认 1 MiB 上限则使用 1009。`acceptWebSocket` 不创建服务器，也不会主动连接远端。

## 常用 API

### 协议 API 地址

`baseUrl` 始终表示协议服务根地址，不会根据 `platform` 或 `selfId` 猜测网关路由。连接 OneBots 时直接传入完整账号协议路径；连接其他实现时传入其标准协议地址。`apiBaseUrl` 仅用于 API 与事件位于不同地址的部署。OneBot action 直接追加到 API 根地址，Milky 使用 `/api/{action}`，Satori 使用 `/{resource}.{method}`。特殊部署也可以通过 `resolveActionUrl` 改写 URL，或注入 `call` 完全接管请求。

### 消息

```typescript
await client.sendPrivateMessage(userId, "你好");
await client.sendGroupMessage(groupId, "大家好");
await client.sendChannelMessage(channelId, "频道消息", guildId);
```

### 实例选择器

```typescript
const user = await client.getUserInfo(userId);
const friend = await client.getFriendInfo(userId);
const group = await client.getGroupInfo(groupId);
const member = await client.getGroupMemberInfo(groupId, userId);
```

查询 API 会把协议 DTO 缓存并投影成绑定当前 Client 的实例。同一实体刷新后保持对象身份，已有引用会立即看到新数据；实例提供 `sendMessage()`、`refresh()`、`kick()`、`mute()` 等对应场景行为。`pick*()` 只选择已经由查询或事件写入缓存的实体，不发起网络请求。

依附父实体的目录必须显式传入 scope。例如 Satori 的频道目录要求公会上下文：

```typescript
const channels = await client.getChannelList({
  scope: { type: "guild", id: guildId },
});
```

`guild` 与 `group` 是不同作用域：Guild/Channel 平台必须使用 `guild`，传统群目录使用 `group`。事件与频道实体会保存已观察到的 Guild，因此从事件回复或调用 `channel.sendMessage()` 时无需重复传入。

消息事件会保留协议动作需要的会话上下文。`reply()`、`recall()`、`edit()` 与频道 reaction 会走 Adapter 的上下文动作入口；只需要全局消息 ID 的协议自动退化到原有 API，需要 `channel_id` 的协议则不会再丢失地址。

### 查询、文件与请求

- `getUserList()`、`getUserInfo()`、`getFriendInfo()`
- `getGroupList()`、`getGroupInfo()`、`getGroupMemberList()`、`getGroupMemberInfo()`
- `getChannelList()`、`getChannelInfo()`、`getChannelMemberList()`、`getChannelMemberInfo()`
- `getMessage()`：返回绑定当前 Client 的消息事件，可直接 `reply()` / `recall()`
- `uploadFile(file, filename?)`、`getFile(fileId)`
- `approveFriendRequest(requestId, approve?, comment?)`
- `approveGroupRequest(requestId, approve?, reason?)`

### 事件

- `message.private`
- `message.group`
- `message.channel`
- `notice.*`
- `request.*`
- `meta.*`
- `event`：适配器主动上报的原始事件

## 自定义适配器

协议适配器继承 `Adapter`，至少提供 `selfId`，并通过 `transformEvent(rawEvent)` 将协议事件转换为标准事件：

```typescript
import { Adapter, createImHelper } from "imhelper";

interface CustomRawEvent {
  type: string;
}

class CustomAdapter extends Adapter<string, CustomRawEvent> {
  readonly selfId = "bot";

  transformEvent(rawEvent: CustomRawEvent): void {
    // 校验并转换 rawEvent，然后调用 this.emit('message.private', data) 等。
  }

  async getUserInfo(userId: string) {
    // Adapter 边界只返回可序列化 DTO；ImHelper 负责构造带行为的 User 实例。
    return { user_id: userId, user_name: "Alice", avatar: "" };
  }
}

const client = createImHelper(new CustomAdapter());

// CustomAdapter、CustomRawEvent 会保留在 client.adapter、ingest() 和 event 事件中。
```

## WebSocket 恢复

主动 WebSocket 默认无限重连，并使用 generation 隔离旧连接回调。协议配置中的 `webSocket` 可传入 `signal`、`reconnect` 和 `logger`：

```typescript
const controller = new AbortController();

const client = createOnebot11Client({
  baseUrl: "ws://localhost:6727/kook/zhin/onebot/v11",
  selfId: "zhin",
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

## 支持的协议

- `@imhelper/onebot-v11`
- `@imhelper/onebot-v12`
- `@imhelper/satori-v1`
- `@imhelper/milky-v1`

许可证：MIT
