# Milky v1 Configuration

Milky uses the shared OneBots HTTP host. Forward HTTP and WebSocket transports are boolean switches; reverse targets are dynamic endpoint lists in the Web UI.

## Example

```yaml
general:
  milky.v1:
    use_http: true
    use_ws: true
    access_token: global-token
    secret: webhook-signature-secret
    http_reverse:
      - url: https://bot.example/events
        access_token: downstream-token
        secret: endpoint-secret
        post_timeout: 5
    ws_reverse:
      - url: wss://bot.example/events
        access_token: downstream-token
        reconnect_interval: 5
    filters:
      event_type:
        - message_receive
        - friend_request
```

Account-level `{platform}.{account_id}.milky.v1` values override `general.milky.v1`.

## Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `use_http` | `boolean` | `true` | Enable `/api/{action}` |
| `use_ws` | `boolean` | `false` | Enable the `/event` forward WebSocket |
| `access_token` | `string` | - | Default token for forward and reverse transports |
| `secret` | `string` | - | Default HMAC secret for reverse HTTP |
| `http_reverse` | endpoint array | `[]` | HTTP event delivery targets |
| `ws_reverse` | endpoint array | `[]` | WebSocket targets opened by OneBots |
| `filters` | event filter | - | Filter canonical Milky events |

`use_http` and `use_ws` do not accept host or port objects. Listener ownership belongs to the shared OneBots host.

## Endpoints

| Transport | Endpoint |
| --- | --- |
| HTTP API | `POST /{platform}/{account_id}/milky/v1/api/{action}` |
| WebSocket | `GET /{platform}/{account_id}/milky/v1/event` |

HTTP reverse endpoint fields are `url`, `access_token`, `secret`, and `post_timeout` in seconds. Reverse WebSocket fields are `url`, `access_token`, and `reconnect_interval` in seconds. Per-endpoint credentials override global values.

Filters match the canonical envelope. Use `event_type` at the root and nested `data.message_scene` for message scenes.

## Links

- [Milky v1 protocol](/en/protocol/milky)
- [Client SDK guide](/en/guide/client-sdk)
