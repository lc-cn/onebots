# WeCom Customer Service

`@onebots/adapter-wecom-kf` targets WeCom Customer Service (`kf/sync_msg`, `kf/send_msg`, and session assignment). Standard custom-application messages use the separate [`wecom`](./wecom.md) adapter; their secrets and conversation models are not interchangeable.

```yaml
wecom-kf.customer_service:
  corp_id: ww1234567890abcdef
  corp_secret: your_wecom_customer_service_secret
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  open_kfid: wkxxxxxxxxxxxxxxxx
  cursor_store_path: ./data/wecom-kf-cursor.json
```

The default callback path is `/wecom-kf/{account_id}/webhook`. Only signed encrypted XML is accepted, and the decrypted CorpID is validated.

See [WeCom Customer Service configuration](/en/config/adapter/wecom-kf) for field defaults and Web form groups.

The adapter acknowledges fully validated callbacks immediately, serializes `sync_msg` pagination per customer-service account in the background, and persists cursors atomically. Stop/restart cancels and generation-isolates stale lifecycle requests. Every raw message/event is preserved, and staff replies use the real `servicer_userid`. Native capabilities include media, links, locations, mini programs, menus, account and servicer management, session state, event-response messages, upgrade service, and statistics. Temporary-media upload does not require an `agent_id`.

See the [package README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wecom-kf) for platform actions and the framework-neutral `ingest` / `acceptHttp` contract.
