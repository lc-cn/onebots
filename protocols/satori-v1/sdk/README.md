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

文本与 Satori Element 会在协议边界显式编解码；非法 Element 会抛出 `ProtocolError`，不会靠类型断言透传。字符串内容里的 [`<emoji>`](https://satori.chat/zh-CN/protocol/elements.html) 会拆成 `emoji` 消息段，`id` 与 `name` 原样保留；不含该标记的字符串仍保持字符串。也可以用 `renderSatoriEmoji()` 生成官方标记，或用 `createSatoriEmojiElement()` 生成元素对象。公会频道的消息删除事件投影为 `notice.channel_message_delete`，不会再伪装成群消息撤回。

`guild-emoji-added`、`guild-emoji-updated`、`guild-emoji-deleted` 会额外发出 `guild-emoji` 事件，并带上 [Emoji](https://satori.chat/zh-CN/resources/emoji.html)。官方事件名是 `guild-emoji-deleted`；本仓库协议服务端当前仍发送 `guild-emoji-removed`，SDK 会一并投影，原始 `event` 不受影响。表情资源缺失时只保留原始事件。

事件上的 [`referrer`](https://satori.chat/zh-CN/advanced/passive.html) 会在 `reply()` 时原样写入 [`/message.create`](https://satori.chat/zh-CN/resources/message.html)。消息资源页的参数表没有列出该字段，被动请求文档要求回复时原样传入，SDK 以后者为准。主动发送可在 `adapter.sendMessage()` 中显式传入 `referrer`。来源事件没有该字段时，请求体不会补这个键。

`addReaction()` / `removeReaction()` 以及 `deleteReaction()`、`clearReaction()`、`listReactions()` 使用 [`emoji_id`](https://satori.chat/zh-CN/resources/reaction.html)，不再发送 `emoji`。`clearReaction()` 省略表情 ID 时清除该消息的全部表态；`deleteReaction()` 可以额外指定 `user_id`。

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

[`friend.list`](https://satori.chat/zh-CN/resources/friend.html) 的元素是 `Friend`（`user?` 与 `nick?`），`client.listFriends()` 返回该形状。`getFriendInfo()` 用 `user.nick`、其次 `user.name` 作为展示名，并把好友 `nick` 放到 `remark`。群成员展示名优先使用群内 `nick`。可选字符串字段为 `null` 时视为缺省。旧服务端如果仍返回扁平 User，列表读取会继续兼容。`deleteFriend()` 调用 `/friend.delete`，`approveFriendRequest()` 调用 `/friend.approve`。

[`GuildMember.roles`](https://satori.chat/zh-CN/resources/member.html) 的类型是 `GuildRole[]`。`adapter.getGroupMemberInfo()` / `getGroupMemberList()` 返回的 `roles` 为 `{ id, name? }`。只含角色 ID 的旧 `string[]` 会读成 `{ id }`；其他形状会抛出 `ProtocolError`。

## 已有宿主

设置 `receiveMode: "manual"` 后，SDK 不创建连接或监听端口：

```typescript
client.ingest(satoriEvent);
await client.acceptHttp(request, response);
const detach = client.acceptWebSocket(upgradedSocket);
```

许可证：MIT
