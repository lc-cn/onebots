# imhelper

`imhelper` 是 OneBots 客户端 SDK 的公共核心。它提供统一的 `ImHelper` 客户端、消息与事件模型；具体协议由 `@imhelper/onebot-v11`、`@imhelper/onebot-v12`、`@imhelper/satori-v1` 和 `@imhelper/milky-v1` 提供。

## 安装

安装核心包和所需的协议适配器：

```bash
pnpm add imhelper @imhelper/onebot-v11
```

## 创建客户端

```typescript
import { createImHelper } from "imhelper";
import { createOnebot11Adapter } from "@imhelper/onebot-v11";

const adapter = createOnebot11Adapter({
  baseUrl: "http://localhost:6727/kook/zhin/onebot/v11",
  selfId: "zhin",
  accessToken: "your_token",
  receiveMode: "ws",
});

const client = createImHelper(adapter);

client.on("message.private", async message => {
  await message.reply("收到！");
});

await client.start();
```

`receiveMode` 支持 `ws`、`wss`、`webhook` 和 `sse`。调用 `start()` 后，由对应协议适配器建立连接；`webhook` 与 `wss` 模式会启动 HTTP 服务，可向 `start(port)` 传入端口。结束时调用 `client.stop()`。

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

### 消息

```typescript
await client.sendPrivateMessage(userId, "你好");
await client.sendGroupMessage(groupId, "大家好");
await client.sendChannelMessage(channelId, "频道消息");
```

### 实例选择器

```typescript
const user = client.pickUser(userId);
const friend = client.pickFriend(userId);
const group = client.pickGroup(groupId);
const channel = client.pickChannel(channelId);
const member = client.pickGroupMember(groupId, userId);
```

实例对象提供对应场景的便捷操作，例如 `user.send(message)`、`group.send(message)`、`channel.send(message)`。

### 查询、文件与请求

- `getUserList()`、`getGroupList()`、`getChannelList()`
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

class CustomAdapter extends Adapter<string> {
  readonly selfId = "bot";

  transformEvent(rawEvent: unknown): void {
    // 校验并转换 rawEvent，然后调用 this.emit('message.private', data) 等。
  }
}

const client = createImHelper(new CustomAdapter());
```

## 支持的协议

- `@imhelper/onebot-v11`
- `@imhelper/onebot-v12`
- `@imhelper/satori-v1`
- `@imhelper/milky-v1`

许可证：MIT
