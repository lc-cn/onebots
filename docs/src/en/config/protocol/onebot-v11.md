# OneBot V11 Protocol Configuration

Complete configuration guide for OneBot V11 protocol.

## Configuration Location

Can be set in `general` as default values, or configured individually at account level:

```yaml
# Global default configuration
general:
  onebot.v11:
    use_http: true
    use_ws: false

# Account level configuration (overrides general)
{platform}.{account_id}:
  onebot.v11:
    use_http: true
    use_ws: true
```

## Configuration Fields

| Field | Type | Required | Description | Default |
|-------|------|----------|-------------|---------|
| `use_http` | `boolean` | No | Whether to enable HTTP API | `true` |
| `use_ws` | `boolean` | No | Whether to enable forward WebSocket | `false` |
| `use_ws_reverse` | `boolean` | No | Whether to enable reverse WebSocket | `false` |
| `access_token` | `string` | No | API access token for authentication | - |
| `secret` | `string` | No | SHA1 signature key for reported data | - |
| `post_timeout` | `number` | No | HTTP POST request timeout (milliseconds) | `5000` |
| `post_message_format` | `string` | No | Message report format: `string` (CQ code) or `array` (message segment array) | `string` |
| `enable_heartbeat` | `boolean` | No | Whether to enable heartbeat | `true` |
| `heartbeat_interval` | `number` | No | Heartbeat interval (milliseconds) | `15000` |
| `enable_cors` | `boolean` | No | Whether to allow CORS | `true` |
| `ws_reverse_url` | `string` | No | Reverse WebSocket connection URL | - |
| `ws_reverse_api_url` | `string` | No | Reverse WebSocket API connection URL (optional) | - |
| `ws_reverse_event_url` | `string` | No | Reverse WebSocket event connection URL (optional) | - |
| `ws_reverse_reconnect_interval` | `number` | No | Reverse WebSocket reconnection interval (milliseconds) | `3000` |
| `http_reverse` | `string[]` | No | HTTP Webhook report URL list | `[]` |
| `ws_reverse` | `string[]` | No | Reverse WebSocket connection URL list | `[]` |

## Communication Methods

### HTTP API

When HTTP API is enabled, provides HTTP POST interface for API calls.

**Access URL**: `http://localhost:6727/{platform}/{account_id}/onebot/v11/{action}`

**Configuration Example**:
```yaml
onebot.v11:
  use_http: true
  access_token: 'your_token'  # Optional, API authentication
  post_timeout: 5000          # Request timeout (milliseconds)
```

### Forward WebSocket

Client actively connects to onebots to receive events in real-time.

**Access URL**: `ws://localhost:6727/{platform}/{account_id}/onebot/v11`

## Related Links

- [OneBot V11 Protocol](/en/protocol/onebot-v11)
- [Global Configuration](/en/config/global)

