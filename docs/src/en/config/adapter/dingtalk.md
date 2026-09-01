# DingTalk Adapter Configuration

The DingTalk adapter configures event ingestion separately from outbound credentials. It uses the official Stream connection by default; HTTP callbacks and embedded hosts share the same event projection and deduplication path.

## Event ingestion modes

| `receive_mode` | Behavior |
|----------------|----------|
| `stream` | Default. OneBots opens the official DingTalk Stream connection; no public callback URL is required |
| `webhook` | Mounts an account HTTP callback route for DingTalk event delivery |
| `manual` | Creates no connection or route; an embedded host calls `bot.ingest()` / `bot.acceptHttp()` |

`webhook_url` is only an outbound connector for a fixed custom-bot group. It does not select `receive_mode` and cannot replace enterprise-bot event ingestion.

## Configuration fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `account_id` | string | Stable OneBots account identity | Required |
| `receive_mode` | `stream` \| `webhook` \| `manual` | Event ingestion mode | `stream` |
| `app_key` | string | Client ID / AppKey used by Stream and OpenAPI | - |
| `app_secret` | string | Client Secret / AppSecret | - |
| `robot_code` | string | Enterprise robot code; falls back to `app_key` | - |
| `agent_id` | string | Used by internal-app APIs such as work notifications | - |
| `corp_id` | string | Enterprise identity for encrypted HTTP callbacks | - |
| `token` | string | HTTP callback signature token | - |
| `encrypt_key` | string | 43-character EncodingAESKey for encrypted callbacks | - |
| `max_pending_event_handlers` | number | In-flight Stream EVENT limit, from 1 to 10000 | `100` |
| `max_pending_callback_handlers` | number | In-flight Stream CALLBACK limit, from 1 to 10000 | `100` |
| `webhook_url` | string | HTTPS outbound URL for a fixed-group custom bot | - |
| `webhook_secret` | string | Custom-bot signing secret | - |

## Stream connection

```yaml
dingtalk.my_bot:
  receive_mode: stream
  app_key: 'your_app_key'
  app_secret: 'your_app_secret'
  robot_code: 'your_robot_code' # optional; defaults to app_key
  max_pending_event_handlers: 100
  max_pending_callback_handlers: 100

  onebot.v11:
    access_token: 'your_v11_token'
```

Create an app in the DingTalk developer console, obtain its AppKey/AppSecret, and subscribe to Stream events. The adapter does not accumulate unbounded work at the concurrency limit: EVENT delivery asks DingTalk to retry later, while CALLBACK delivery is left for server retry.

## HTTP callback

```yaml
dingtalk.my_bot:
  receive_mode: webhook
  app_key: 'your_app_key'
  app_secret: 'your_app_secret'
  corp_id: 'ding_corp_id'
  token: 'callback_token'
  encrypt_key: '43_character_encoding_aes_key_here______'
```

The account route is:

```text
https://your-domain.example/dingtalk/my_bot/webhook
```

Expose this route through an HTTPS reverse proxy in production. Enabling `encrypt_key` also requires `corp_id`; the adapter verifies the signature, decrypts the request, and returns an encrypted response.

## Custom-bot outbound delivery

```yaml
dingtalk.my_bot:
  receive_mode: manual
  webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN'
  webhook_secret: 'SEC...'
```

This configuration only provides fixed-group outbound delivery. Treat the configuration file as sensitive and never expose the URL access token in logs, commands, or documentation.

## Startup timeout and cancellation

DingTalk account startup, the Stream handshake, access-token verification, and subsequent protocol outlets share the global OneBots `timeout`. A timeout, manual stop, or configuration-reload cancellation aborts the token request, disconnects an unfinished Stream, and prevents a transport that ignores cancellation from caching a late token or restoring online state. The signal remains active after account readiness until protocol outlets finish, so a failed outlet startup also rolls back the account connection.

## Related links

- [DingTalk Platform](/en/platform/dingtalk)
- [Quick Start](/en/guide/start)
