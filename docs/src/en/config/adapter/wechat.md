# WeChat Official Account Configuration

```yaml
wechat.my_mp:
  app_id: wx1234567890abcdef
  app_secret: your_app_secret
  receive_mode: webhook
  token: your_webhook_token
  encoding_aes_key: your_43_character_key
  webhook_path: /wechat/my_mp/webhook
  passive_reply_timeout_ms: 4500
  deduplicate_webhooks: true
  webhook_deduplication_limit: 10000
  api_base_url: https://api.weixin.qq.com
```

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `app_id` | Yes | - | Official Account AppID and encrypted-message recipient identity |
| `app_secret` | Yes | - | Sensitive credential used to obtain the global access token |
| `receive_mode` | No | `webhook` | `webhook` registers the shared Host route; `manual` only accepts `ingest()` |
| `token` | Webhook mode | - | SHA-1 webhook signature token |
| `encoding_aes_key` | Safe/compatible mode | - | 43-character message encryption key |
| `webhook_path` | No | `/wechat/{account_id}/webhook` | Callback path on the shared HTTP Host |
| `passive_reply_timeout_ms` | No | `4500` | Passive-reply wait, at most 4500 ms; `0` acknowledges immediately |
| `deduplicate_webhooks` | No | `true` | Filters WeChat retry deliveries |
| `webhook_deduplication_limit` | No | `10000` | In-process recent event-ID capacity |
| `api_base_url` | No | `https://api.weixin.qq.com` | HTTPS-compatible official API proxy or test endpoint |

All field names use snake_case. Historical camelCase aliases and account-type feature switches are intentionally unsupported; actual endpoint availability is determined by the Official Account's type, verification, and granted permissions.
