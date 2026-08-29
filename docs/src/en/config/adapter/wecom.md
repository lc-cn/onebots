# WeCom Custom Application Configuration

```yaml
wecom.internal_app:
  corp_id: ww1234567890abcdef
  corp_secret: your_application_secret
  agent_id: '1000001'
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  webhook_path: /wecom/internal_app/webhook
  deduplicate_webhooks: true
  webhook_deduplication_limit: 10000
  api_base_url: https://qyapi.weixin.qq.com
```

`token` and the 43-character `encoding_aes_key` are required because the adapter only accepts encrypted callbacks. `corp_id` is also validated against the decrypted callback receive ID. `agent_id` must contain digits only.
