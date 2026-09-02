# Twitch 配置

## 安装

```bash
pnpm add @onebots/adapter-twitch
onebots -r twitch
```

先在 Twitch Developer Console 创建应用并取得 Client ID。OneBots 启动时会调用官方 OAuth validation endpoint，令牌所属 Client ID 不一致会直接失败。

## EventSub WebSocket

WebSocket 必须使用用户访问令牌。聊天机器人通常至少需要 `user:bot`、`user:read:chat`、`user:write:chat`；实际 Helix 动作和订阅还需要官方参考中对应的 scope。

```yaml
twitch.stream_bot:
  client_id: ${TWITCH_CLIENT_ID}
  access_token: ${TWITCH_USER_TOKEN}
  broadcaster_user_id: "123456"
  bot_user_id: "654321"
  moderator_user_id: "654321"
  receive_mode: websocket
  subscriptions:
    - type: channel.chat.message
    - type: channel.chat.message_delete
    - type: channel.follow
    - type: channel.moderate
  reconnect_initial_delay_ms: 1000
  reconnect_max_delay_ms: 30000
```

Web 表单中的订阅是可动态增减的结构化记录。选择事件后只展示对应 condition 字段，不需要手写 JSON；版本留空时使用目录中的最新稳定版本。Guest Star 等仍标为 Beta 的类型不会进入自动订阅下拉。

## EventSub Webhook

自动 Webhook 订阅必须使用应用访问令牌。Callback 必须是 Twitch 可访问的公网 HTTPS 443 地址，Secret 必须为 10–100 个 ASCII 可打印字符。

```yaml
twitch.webhook:
  client_id: ${TWITCH_CLIENT_ID}
  access_token: ${TWITCH_APP_TOKEN}
  broadcaster_user_id: "123456"
  bot_user_id: "654321"
  receive_mode: webhook
  webhook_callback_url: https://bot.example.com/twitch/webhook/eventsub
  http_path: /twitch/webhook/eventsub
  webhook_secret: ${TWITCH_EVENTSUB_SECRET}
  subscriptions:
    - type: channel.update
    - type: channel.bits.use
```

`http_path` 是 OneBots 主 HTTP Host 的本地路由；反向代理改写路径时可与公网 callback 分开配置。内建 Host 不另开端口，并把原始 body 和 Twitch headers 交给同一个 Client 验签。Drops 只能走 Webhook：

```yaml
  subscriptions:
    - type: drop.entitlement.grant
      organization_id: organization-id
      category_id: optional-category-id
```

适配器会自动发送 `is_batching_enabled: true`，并把官方批量 `events` 在一个 envelope 级去重事务中逐项投影。

## 已有 Host、socket 或 consumer

```ts
import { TwitchClient } from "@onebots/adapter-twitch";

const client = new TwitchClient({
  account_id: "embedded",
  client_id: process.env.TWITCH_CLIENT_ID!,
  access_token: process.env.TWITCH_USER_TOKEN!,
  broadcaster_user_id: "123456",
  bot_user_id: "654321",
  receive_mode: "manual",
});

await client.start(signal);
client.on("event", delivery => dispatch(delivery));

const response = await client.acceptHttp(fetchRequest);
await client.acceptSocket(upgradedSocket, { owned: false }, signal);
await client.ingest(decodedEventSubEnvelope);
```

`acceptHttp()` 要求宿主保留原始请求 body，返回可直接写回的 Fetch `Response`。`acceptSocket()` 接收 `ws.WebSocket`；`owned: false` 时 `stop()` 只解绑。`ingest()` 接受解码后的官方 envelope，并复用严格校验、订阅过滤、可靠去重和 canonical 投影。verification challenge 必须经过 `acceptHttp()`，不能绕过签名边界直接 ingest。

## 关键字段

| 字段 | 必填 | 说明 |
|---|---:|---|
| `client_id` | 是 | Twitch 应用 Client ID |
| `access_token` | 是 | 敏感字段；WebSocket 用用户令牌，自动 Webhook 用应用令牌 |
| `broadcaster_user_id` | 是 | 绑定频道的数字 User ID |
| `bot_user_id` | 否 | Bot 用户 ID；WebSocket 配置时必须与令牌主体一致 |
| `moderator_user_id` | 否 | moderation API 身份，默认 bot/broadcaster |
| `receive_mode` | 否 | `websocket`（默认）、`webhook` 或 `manual` |
| `subscriptions` | 否 | 官方稳定 EventSub 结构化订阅列表 |
| `auto_subscribe` | 否 | 关闭后只消费由外部系统创建的订阅 |
| `webhook_callback_url` | Webhook 自动订阅 | 公网 HTTPS 443 callback |
| `http_path` | 否 | OneBots 本地 Host 路由，默认从 callback 推导 |
| `webhook_secret` | Webhook | HMAC secret，10–100 个 ASCII 字符 |
| `max_response_bytes` | 否 | Helix/OAuth 响应和 Webhook body 内存上限 |

`client.call()` 与 `call_twitch_api` 只接受 Helix 安全相对路径。账号能力会按已验证 OAuth scope 和 `subscriptions` 收敛，Web 能力面板不会展示当前令牌或事件配置实际不可达的能力。

平台映射见 [Twitch 平台说明](/platform/twitch)。
