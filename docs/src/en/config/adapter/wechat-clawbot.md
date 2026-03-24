# WeChat ClawBot adapter configuration

Platform id **`wechat-clawbot`**. Most endpoints and defaults are fixed by the adapter; YAML usually only needs the account key and optional timeouts.

## Format

```yaml
wechat-clawbot.{account_id}:
  # optional
  # qr_login_timeout_ms: 480000
  # polling_timeout_ms: ...
  # polling_retry_delay_ms: ...
```

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `account_id` | string | yes | Part of the key `wechat-clawbot.{account_id}` |
| `qr_login_timeout_ms` | number | no | QR login timeout (ms), default `480000` |
| `polling_timeout_ms` | number | no | Long-poll timeout for `getupdates` |
| `polling_retry_delay_ms` | number | no | Delay before retry after poll errors |

See the adapter README for the full convention table (API root, CDN, `bot_type`, etc.).

## See also

- [WeChat ClawBot platform](/en/platform/wechat-clawbot)
- [中文说明](/platform/wechat-clawbot)
