# WeCom Customer Service Configuration

```yaml
wecom-kf.customer_service:
  corp_id: ww1234567890abcdef
  corp_secret: your_wecom_customer_service_secret
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  open_kfid: wkxxxxxxxxxxxxxxxx
  webhook_path: /wecom-kf/customer_service/webhook
  cursor_store_path: ./data/wecom-kf-cursor.json
  deduplicate_messages: true
  message_deduplication_limit: 10000
  enable_sync_poll: false
  sync_poll_interval_ms: 30000
  api_base_url: https://qyapi.weixin.qq.com
```

The callback credentials are required because only signed encrypted XML is accepted. `corp_secret` is the WeCom Customer Service API secret. `open_kfid` is optional unless compensating polling is enabled. Cursors are persisted with asynchronous atomic replacement when `cursor_store_path` is set.

Temporary media upload does not require `agent_id`; that legacy field is no longer read.
