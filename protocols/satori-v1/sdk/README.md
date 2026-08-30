# @imhelper/satori-v1

Satori v1 客户端 SDK，导出 `SatoriV1Client`、`SatoriAdapter`、对应 factory、原始事件类型和原生 `call(resource, method, params)`。

## 创建客户端

```typescript
import { createSatoriClient } from "@imhelper/satori-v1";

const client = createSatoriClient({
  baseUrl: "https://satori.example/v1",
  platform: "discord",
  selfId: "bot-id",
  accessToken: "token",
  receiveMode: "ws",
});

client.on("message.channel", async message => {
  await message.reply("收到");
  await message.addReaction("👍");
});

await client.start();
```

`baseUrl` 是原生 Satori API 根地址，不会猜测 OneBots 网关路径。事件地址默认在其后追加 `/events`；API 使用 `/{resource}.{method}`。也可设置 `apiBaseUrl`、`wsUrl`、`resolveActionUrl`，或注入 `call`。

## 平台上下文

私聊发送会先调用 `user.channel.create` 获取真实直接消息频道，再调用 `message.create`。从事件调用 `reply()`、`recall()`、`edit()`、`addReaction()` 或 `removeReaction()` 时会原样复用事件的 `channel_id`。

文本与 Satori Element 会在协议边界显式编解码；非法 Element 会抛出 `ProtocolError`，不会靠类型断言透传。公会频道的消息删除事件投影为 `notice.channel_message_delete`，不会再伪装成群消息撤回。

Satori 不允许向 guild ID 直接发送消息，因此 `sendGroupMessage()` 会抛出结构化 `UnsupportedAdapterOperationError`；请选择真实 channel 后调用 `sendChannelMessage()`。

频道列表必须显式提供 guild scope：

```typescript
const channels = await client.getChannelList({
  scope: { type: "guild", id: guildId },
});

const channel = await client.getChannelInfo(channelId, {
  scope: { type: "guild", id: guildId },
});

await channel.setName("general");
```

好友、公会、成员和频道列表遵循 Satori `List<T>` 分页结构并自动读取全部页面。成功响应的数据结构不合法、游标循环或缺少必需 scope 时抛出 `ProtocolError`，不会返回伪造的空列表。

## 已有宿主

设置 `receiveMode: "manual"` 后，SDK 不创建连接或监听端口：

```typescript
client.ingest(satoriEvent);
await client.acceptHttp(request, response);
const detach = client.acceptWebSocket(upgradedSocket);
```

许可证：MIT
