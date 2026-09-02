# @onebots/adapter-twitch

Twitch adapter for OneBots, built on the official Helix API and EventSub WebSocket/Webhook transports. One typed `TwitchClient` serves managed connections, an existing HTTP Host, upgraded sockets, and manual ingress without opening a private listener.

## 特性

- 可嵌入 `TwitchClient`，公开强类型 Helix API、受控 `call()`、`acceptHttp()`、`acceptSocket()` 与 `ingest()`；
- EventSub WebSocket 使用用户令牌，支持 welcome、keepalive watchdog、官方 `reconnect_url` 无损迁移、普通断线重订阅、默认无限指数退避和 `AbortSignal`；
- EventSub Webhook 使用应用令牌自动订阅，校验原始 body HMAC-SHA256、重放时窗、challenge、大小上限与重复投递；
- 官方稳定 EventSub 目录统一驱动版本、condition、transport 和 Web 动态记录表单；Beta 类型不会伪装为稳定能力；
- Drops 的 Webhook-only 限制、`is_batching_enabled` 和批量 `events` 完整保留并逐项投影；
- channel chat、whisper、mention、emote、cheermote、GIF、reply、moderation、订阅和未知 EventSub 原始事件投影；
- 频道聊天、私信、公告、删除消息、封禁、moderator/VIP、Automod、奖励、poll、prediction、raid、schedule、video 等平台动作；
- OAuth validation 校验令牌主体、Client ID 与 scope，账号能力随实际订阅和 scope 动态收敛。

## Standalone Client

```ts
import { TwitchClient } from "@onebots/adapter-twitch";

const client = new TwitchClient({
  account_id: "stream-bot",
  client_id: process.env.TWITCH_CLIENT_ID!,
  access_token: process.env.TWITCH_USER_TOKEN!,
  broadcaster_user_id: "123456",
  bot_user_id: "654321",
  receive_mode: "manual",
});

await client.start(signal);
client.on("event", delivery => dispatch(delivery));

// 已有 Fetch/Koa/Workers Host：保留原始 body 与 Twitch headers。
const response = await client.acceptHttp(request);

// 已升级的 ws.WebSocket；owned: false 时 stop() 不关闭宿主连接。
await client.acceptSocket(socket, { owned: false }, signal);

// 队列、反向连接或测试夹具的最低层入口。
await client.ingest(rawEventSubEnvelope);
```

`call(method, path, options)` 只接受 Helix 根下不含 query 的安全相对资源路径；绝对 URL、前导 `/`、路径穿越和百分号编码路径都会在网络请求前失败。`acceptHttp()` 返回结构化 `Response`，challenge 返回纯文本，notification/revocation 成功返回 `204`。

EventSub WebSocket requires a user access token. Automatic Webhook subscriptions require an app access token and a public HTTPS callback on port 443. Twitch chat with app authorization also requires prior `user:bot` and broadcaster `channel:bot` authorization as documented by Twitch.

See the [Chinese configuration guide](../../docs/src/config/adapter/twitch.md), [English configuration guide](../../docs/src/en/config/adapter/twitch.md), and official [Helix API](https://dev.twitch.tv/docs/api/reference), [EventSub](https://dev.twitch.tv/docs/eventsub/), [subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/), and [OAuth scopes](https://dev.twitch.tv/docs/authentication/scopes/).
