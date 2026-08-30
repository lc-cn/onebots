# WeChat Official Account Adapter

`@onebots/adapter-wechat` uses the official WeChat API, accepts signed/encrypted webhooks on the shared OneBots HTTP host, and exposes events and APIs through configured protocols.

```yaml
wechat.my_mp:
  app_id: wx1234567890abcdef
  app_secret: your_app_secret
  token: your_webhook_token
  encoding_aes_key: your_43_character_key
  passive_reply_timeout_ms: 4500
  deduplicate_webhooks: true

  onebot.v11:
    use_http: true
    use_ws: true
```

Configure `https://bot.example.com/wechat/my_mp/webhook` in the WeChat console. The default path is `/wechat/{account_id}/webhook`; override it with `webhook_path`.

The adapter receives every official-account message and event, preserves `raw_event` plus the complete `RawXml`, and supports active customer-service messages and correlated passive replies. Media must use an uploaded `media_id`; URLs are never silently converted into placeholder text.

WeChat user tags are audience-management objects, not chat groups. Native actions cover users, tags, blocklists, media, drafts, publishing, menus, QR codes, templates, subscription notifications, mass messaging, web OAuth, cached JS-SDK tickets and ready-to-use signature configuration, API quota, RID diagnostics, API domains, callback IPs, and callback connectivity checks. OAuth access tokens stay separate from the cached Official Account token. Access tokens use the stable-token endpoint. Webhook and manual ingress share awaited delivery, in-flight coalescing, and deduplication inside the client. Use `wechat_call` for newly introduced or uncommon official endpoints.

The canonical `get_user_info` action accepts `user_id`. Use `get_wechat_user_info` with `openid` and optional `lang` when the native WeChat language parameter is required; the distinct name prevents the platform action from being shadowed by canonical routing.

See the [package README](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wechat) for the complete API and embedding contract.
