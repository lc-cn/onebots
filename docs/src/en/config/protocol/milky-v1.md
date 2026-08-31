# Milky V1 Protocol Configuration

Complete configuration guide for Milky V1 protocol.

## Configuration Location

Can be set in `general` as default values, or configured individually at account level:

```yaml
# Global default configuration
general:
  milky.v1:
    use_http: true
    use_ws: false

# Account level configuration (overrides general)
{platform}.{account_id}:
  milky.v1:
    use_http: true
    use_ws: true
```

## Configuration Fields

| Field | Type | Required | Description | Default |
|-------|------|----------|-------------|---------|
| `use_http` | `boolean` \| `HttpConfig` | No | Whether to enable HTTP API or HTTP config object | `true` |
| `use_ws` | `boolean` \| `WsConfig` | No | Whether to enable WebSocket or WebSocket config object | `false` |
| `access_token` | `string` | No | Access token for authentication | - |
| `secret` | `string` | No | HMAC signature key | - |
| `heartbeat` | `number` | No | Heartbeat interval (seconds) | - |
| `post_message_format` | `string` | No | Message format: `string` or `array` | `string` |
| `http_reverse` | `string[]` \| `HttpReverseConfig[]` | No | HTTP reverse push configuration list | `[]` |
| `ws_reverse` | `string[]` \| `WsReverseConfig[]` | No | WebSocket reverse connection configuration list | `[]` |
| `filters` | `any` | No | Event filters | - |

## Related Links

- [Milky Protocol](/en/protocol/milky)
- [Global Configuration](/en/config/global)

