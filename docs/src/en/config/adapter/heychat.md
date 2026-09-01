# Heychat Adapter Configuration

The Heychat (黑盒语音) adapter opens the official forward WebSocket by default for commands, replies, member changes, and card interactions. An embedded host can select `manual` and feed an existing connection into the same projection and deduplication path.

## Minimal configuration

```yaml
heychat.game_bot:
  token: 'your_bot_token'
  receive_mode: websocket

  onebot.v11:
    access_token: 'your_v11_token'
```

`receive_mode` accepts:

| Value | Behavior |
|-------|----------|
| `websocket` | Default. OneBots opens a forward WebSocket and reconnects forever with exponential backoff |
| `manual` | Opens no network connection; the host calls `HeychatBot.ingest()` or `acceptWebSocket()` |

## Configuration fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `account_id` | string | Stable OneBots account identity | Required |
| `token` | string | Bot token issued by the robot console | Required |
| `receive_mode` | `websocket` \| `manual` | Event ingestion mode | `websocket` |
| `api_base_url` | string | REST API root | `https://chat.xiaoheihe.cn` |
| `upload_base_url` | string | Media-upload API root | `https://chat-upload.xiaoheihe.cn` |
| `ws_url` | string | Forward WebSocket URL | Official endpoint |
| `chat_version` | string | Client version sent with official requests | `1.30.0` |
| `voice_api_type` | `trtc` \| `volc` | Voice-channel service line | `trtc` |
| `heartbeat_interval_ms` | number | Heartbeat interval, at least 5000 ms | `30000` |
| `reconnect_initial_delay_ms` | number | First reconnect delay, at least 100 ms | `1000` |
| `reconnect_max_delay_ms` | number | Maximum reconnect delay; cannot be lower than the initial delay | `30000` |
| `request_timeout_ms` | number | REST request and WebSocket handshake timeout | `30000` |
| `proxy.url` | string | Shared HTTP/SOCKS proxy for HTTP(S) and WebSocket | - |
| `proxy.username` | string | Proxy username | - |
| `proxy.password` | string | Proxy password | - |

Legacy fields `api_base`, `upload_base`, `ping_interval`, and `ignore_self_messages` are not part of the current configuration contract. Use the fields above; the management schema produces the same structure.

## Connection and retries

```yaml
heychat.game_bot:
  token: 'your_bot_token'
  receive_mode: websocket
  ws_url: 'wss://chat.xiaoheihe.cn/chatroom/ws/connect'
  chat_version: '1.30.0'
  heartbeat_interval_ms: 30000
  reconnect_initial_delay_ms: 1000
  reconnect_max_delay_ms: 30000
  request_timeout_ms: 30000
```

The connection retries forever with jittered exponential backoff. Missing pong traffic for one heartbeat period rebuilds the connection. Events are delivered in local order; a failed business outlet retries with bounded backoff, and account shutdown immediately cancels queued waits.

## Startup timeout and cancellation

The forward WebSocket handshake and subsequent protocol outlets share the global OneBots `timeout`. A timeout, manual stop, or configuration-reload cancellation terminates the pending socket, clears reconnect and heartbeat timers, and explicitly settles the unfinished connection promise. Connection generations prevent late callbacks from restoring account state. The account signal remains attached after bot readiness so a failed protocol startup can roll back the connection completely.

## Manual ingestion

```yaml
heychat.embedded:
  token: 'your_bot_token'
  receive_mode: manual
```

`manual` opens no WebSocket. The host can pass parsed events or attach an already-upgraded socket through `acceptWebSocket()`. The adapter listens only for business frames and does not take ownership of host heartbeat, close, or reconnect behavior.

## User OAuth

Extended actions that read user profiles or voice duration require separate OAuth credentials. Regular bot actions do not:

```yaml
heychat.game_bot:
  token: 'your_bot_token'
  oauth:
    enabled: true
    client_id: 'oauth_client_id'
    client_secret: 'oauth_client_secret'
    redirect_uri: 'https://your-domain.example/oauth/heychat'
```

## Getting a token

1. Complete verification on the [Heychat developer platform](https://open.xiaoheihe.cn/zh_cn/chat_robot/home).
2. Create a robot in the [bot console](https://bot.xiaoheihe.cn) and copy its token.
3. Register slash commands in advance so the bot can receive their `type=50` events.

Use `room_id:channel_id` as `scene_id` for direct channel delivery. When only `channel_id` is available, the adapter must first observe an event from that channel to build an exact room mapping; it does not guess the destination.

## See also

- [Heychat platform guide](/en/platform/heychat)
- [Official API documentation](https://s.apifox.cn/43256fe4-9a8c-4f22-949a-74a3f8b431f5)
