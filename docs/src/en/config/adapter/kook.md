# Kook Adapter Configuration

Kook (formerly Kaiheila) adapter configuration guide.

## Configuration Format

```yaml
kook.{account_id}:
  # Kook platform configuration
  token: 'your_kook_token'        # Required: Kook Bot Token
  mode: 'websocket'                # Optional: Connection mode, 'websocket' (default) or 'webhook'
  verifyToken: 'your_verify_token' # Optional: Webhook verification Token (required for webhook mode)
  encryptKey: 'your_encrypt_key'   # Optional: Message encryption key
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
  onebot.v12:
    access_token: 'your_v12_token'
  satori.v1:
    token: 'your_satori_token'
    platform: 'kook'
  milky.v1:
    access_token: 'your_milky_token'
```

## Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | Kook Bot Token, get from [KOOK Developer Platform](https://developer.kookapp.cn/) |
| `mode` | string | No | Connection mode:<br>- `websocket` (default): Use WebSocket connection, real-time event reception<br>- `webhook`: Use webhook mode, requires callback URL configuration |
| `verifyToken` | string | No | Webhook verification Token, required for webhook mode |
| `encryptKey` | string | No | Message encryption key, optional |

## Connection Modes

### WebSocket Mode (Recommended)

WebSocket mode is the default mode, providing real-time bidirectional communication:

```yaml
kook.zhin:
  token: 'your_kook_token'
  mode: 'websocket'  # Can be omitted, default value
```

**Advantages**:
- Real-time event reception
- Low latency
- Bidirectional communication

### Webhook Mode

Webhook mode requires callback URL configuration, suitable for server deployment scenarios:

```yaml
kook.zhin:
  token: 'your_kook_token'
  mode: 'webhook'
  verifyToken: 'your_verify_token'
```

**Advantages**:
- Suitable for serverless scenarios
- No need to maintain persistent connection
- Easy to scale

## Related Links

- [Kook Platform](/en/platform/kook)
- [Quick Start](/en/guide/start)

