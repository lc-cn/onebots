# WeChat ClawBot adapter configuration

Platform id **`wechat-clawbot`**. Most endpoints and defaults are fixed by the adapter; YAML usually only needs the account key and optional timeouts.

## Format

```yaml
wechat-clawbot.{account_id}:
  # optional
  # qr_login_timeout_ms: 480000
  # polling_timeout_ms: ...
  # polling_retry_initial_delay_ms: 1000
  # polling_retry_max_delay_ms: 30000
```

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `account_id` | string | yes | Part of the key `wechat-clawbot.{account_id}` |
| `qr_login_timeout_ms` | number | no | QR login timeout (ms), default `480000` |
| `polling_timeout_ms` | number | no | Long-poll timeout for `getupdates` |
| `polling_retry_initial_delay_ms` | number | no | Initial retry delay; exponential backoff starts at `1000` ms |
| `polling_retry_max_delay_ms` | number | no | Retry delay ceiling, default `30000` ms |

See the adapter README for the full convention table (API root, CDN, `bot_type`, etc.).
Polling recovers indefinitely and an account stop immediately aborts the active request.

## See also

- [WeChat ClawBot platform](/en/platform/wechat-clawbot)
- [中文说明](/platform/wechat-clawbot)
