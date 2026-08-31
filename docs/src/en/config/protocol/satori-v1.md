# Satori V1 Protocol Configuration

Complete configuration guide for Satori V1 protocol.

## Configuration Location

Can be set in `general` as default values, or configured individually at account level:

```yaml
# Global default configuration
general:
  satori.v1:
    use_ws: true
    path: /satori

# Account level configuration (overrides general)
{platform}.{account_id}:
  satori.v1:
    use_ws: true
    path: /satori
    token: 'your_token'
```

## Configuration Fields

| Field | Type | Required | Description | Default |
|-------|------|----------|-------------|---------|
| `use_http` | `boolean` \| `HttpConfig` | No | Whether to enable HTTP API or HTTP config object | `false` |
| `use_ws` | `boolean` \| `WsConfig` | No | Whether to enable WebSocket or WebSocket config object | `true` |
| `token` | `string` | No | Access token for authentication | - |
| `self_id` | `string` | No | Bot ID | - |
| `platform` | `string` | No | Platform name | `satori` |
| `webhooks` | `string[]` \| `WebhookConfig[]` | No | Webhook configuration list | `[]` |
| `filters` | `any` | No | Event filters | - |

## Related Links

- [Satori Protocol](/en/protocol/satori)
- [Global Configuration](/en/config/global)

