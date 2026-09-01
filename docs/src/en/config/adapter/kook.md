# Kook Adapter Configuration

Kook (formerly Kaiheila) adapter configuration guide.

## Configuration Format

```yaml
kook.{account_id}:
  # Kook platform configuration
  token: 'your_kook_token'        # Required: Kook Bot Token
  receive_mode: 'gateway'           # Optional: gateway (default), webhook, or manual
  verify_token: 'your_verify_token' # Required in webhook mode
  encrypt_key: 'your_encrypt_key'   # Optional webhook encryption key
  max_retries: 3                    # Optional REST rate-limit retries, 0-10
  
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
| `receive_mode` | string | No | Event ingress: `gateway` (default), `webhook`, or `manual` |
| `verify_token` | string | No | Webhook verification token, required in webhook mode |
| `encrypt_key` | string | No | Webhook message encryption key |
| `api_base_url` | string | No | HTTPS base URL for the KOOK REST API; defaults to the official endpoint |
| `max_retries` | number | No | Maximum REST rate-limit retries; defaults to 3 and accepts 0-10 |

## Connection Modes

### Gateway Mode (Recommended)

Gateway mode is the default and receives events over WebSocket:

```yaml
kook.zhin:
  token: 'your_kook_token'
  receive_mode: 'gateway'  # Can be omitted
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
  receive_mode: 'webhook'
  verify_token: 'your_verify_token'
```

**Advantages**:
- Suitable for serverless scenarios
- No need to maintain persistent connection
- Easy to scale

### Manual Mode

`manual` validates the bot identity without opening a Gateway or Webhook event ingress. It is intended for an existing host that feeds events through the SDK's `ingest()` or `acceptHttp()` boundary.

## Startup Timeout and Cancellation

KOOK account startup observes the global OneBots `timeout`. When startup times out or a configuration reload cancels it, the adapter aborts identity and Gateway URL requests, closes a WebSocket that is still waiting for HELLO, and prevents late responses from restoring online state. The signal remains active until protocol outlets finish, so a failed outlet startup also closes the Gateway during rollback.

## Related Links

- [Kook Platform](/en/platform/kook)
- [Quick Start](/en/guide/start)
