# WeCom Custom Application Configuration

```yaml
wecom.internal_app:
  corp_id: ww1234567890abcdef
  corp_secret: your_application_secret
  directory_secret: your_address_book_sync_secret # only for contact writes/imports
  agent_id: '1000001'
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  receive_mode: webhook
  webhook_path: /wecom/internal_app/webhook
  deduplicate_webhooks: true
  webhook_deduplication_limit: 10000
  api_base_url: https://qyapi.weixin.qq.com
```

`receive_mode` defaults to `webhook`; in that mode, `token` and the 43-character `encoding_aes_key` are required because only encrypted callbacks are accepted. Set it to `manual` to skip route registration and submit trusted decrypted events with `await client.ingest(event)`; callback credentials are then optional. `corp_id` is validated against decrypted callback receive IDs, and `agent_id` must contain digits only.

`directory_secret` is optional unless a contact write or asynchronous import action is used. Those operations obtain a separately cached directory token and never fall back to the custom application's `corp_secret`.

The initial application credential and identity requests, asynchronous readiness listeners, and subsequent protocol outlets share the global OneBots `timeout`. A startup timeout, manual stop, or configuration reload aborts in-flight requests, while startup generations prevent late responses that ignored cancellation from restoring online state. The startup signal remains attached after readiness so a failed protocol startup can roll back the client completely.
