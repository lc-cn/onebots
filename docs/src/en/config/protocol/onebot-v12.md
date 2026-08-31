# OneBot V12 Protocol Configuration

Complete configuration guide for OneBot V12 protocol.

## Configuration Location

Can be set in `general` as default values, or configured individually at account level:

```yaml
# Global default configuration
general:
  onebot.v12:
    use_http: true
    use_ws: false

# Account level configuration (overrides general)
{platform}.{account_id}:
  onebot.v12:
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
| `request_timeout` | `number` | No | HTTP request timeout (milliseconds) | `15000` |
| `enable_cors` | `boolean` | No | Whether to allow CORS | `true` |
| `heartbeat_interval` | `number` | No | Heartbeat interval (milliseconds) | `15000` |
| `ws_reverse_url` | `string` | No | Reverse WebSocket connection URL | - |
| `ws_reverse_reconnect_interval` | `number` | No | Reverse WebSocket reconnection interval (milliseconds) | `3000` |
| `webhook` | `string[]` | No | HTTP Webhook report URL list | `[]` |
| `ws_reverse` | `string[]` | No | Reverse WebSocket connection URL list | `[]` |

## Communication Methods

### HTTP API

When HTTP API is enabled, provides HTTP POST interface for API calls.

**Access URL**: `http://localhost:6727/{platform}/{account_id}/onebot/v12/{action}`

**Configuration Example**:
```yaml
onebot.v12:
  use_http: true
  access_token: 'your_token'  # Optional, API authentication
  request_timeout: 15000      # Request timeout (milliseconds)
```

### Forward WebSocket

Client actively connects to onebots to receive events in real-time.

**Access URL**: `ws://localhost:6727/{platform}/{account_id}/onebot/v12`

## Related Links

- [OneBot V12 Protocol](/en/protocol/onebot-v12)
- [Global Configuration](/en/config/global)

