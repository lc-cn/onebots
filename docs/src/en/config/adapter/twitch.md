# Twitch configuration

## Install

```bash
pnpm add @onebots/adapter-twitch
onebots -r twitch
```

Create an application in the Twitch Developer Console and obtain its Client ID. Startup validates the token through Twitch's OAuth validation endpoint and rejects a token issued to another Client ID.

## EventSub WebSocket

WebSocket delivery requires a user access token. A chat bot commonly needs `user:bot`, `user:read:chat`, and `user:write:chat`; each selected Helix action and EventSub type may require additional scopes.

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

The Web form renders subscriptions as dynamic structured rows. Selecting a type reveals only its applicable condition fields. An omitted version selects the latest stable version in the catalog; Beta types such as Guest Star are not presented as stable automatic subscriptions.

## EventSub Webhook

Automatic Webhook subscription creation requires an app access token, a public HTTPS callback on port 443, and a 10–100 printable ASCII secret.

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

`http_path` is mounted on the shared OneBots HTTP Host and may differ from the public path when a reverse proxy rewrites URLs. Drops are Webhook-only; set `organization_id` on `drop.entitlement.grant`. The adapter adds `is_batching_enabled: true` and expands the official batched `events` payload under one envelope-level idempotency transaction.

## Existing Host, socket, or consumer

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

The Host must preserve the raw HTTP body for HMAC verification. `acceptHttp()` returns a Fetch `Response`; `acceptSocket()` accepts `ws.WebSocket`, and `owned: false` keeps Host ownership. `ingest()` reuses strict parsing, subscription filtering, reliable deduplication, and canonical projection. Verification challenges must pass through `acceptHttp()` and cannot bypass the signature boundary.

| Field | Required | Meaning |
|---|---:|---|
| `client_id` | yes | Twitch application Client ID |
| `access_token` | yes | Sensitive user token for WebSocket, or app token for automatic Webhooks |
| `broadcaster_user_id` | yes | Numeric user ID of the bound channel |
| `bot_user_id` | no | Bot user ID; must match the WebSocket token subject when set |
| `moderator_user_id` | no | Identity used by moderation APIs |
| `receive_mode` | no | `websocket` (default), `webhook`, or `manual` |
| `subscriptions` | no | Structured stable EventSub subscriptions |
| `auto_subscribe` | no | Disable when an external service owns subscriptions |
| `webhook_callback_url` | automatic Webhook | Public HTTPS port 443 callback |
| `http_path` | no | Route on the shared OneBots Host |
| `webhook_secret` | Webhook | 10–100 printable ASCII HMAC secret |
| `max_response_bytes` | no | Memory bound for Helix/OAuth responses and Webhook bodies |

`client.call()` and `call_twitch_api` accept safe Helix-relative resource paths only. Account capabilities are narrowed using validated OAuth scopes and configured EventSub subscriptions.

See [Twitch platform behavior](/en/platform/twitch).
