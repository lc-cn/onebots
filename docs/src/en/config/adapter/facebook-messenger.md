# Facebook Messenger configuration

Install and load the adapter:

```bash
pnpm add @onebots/adapter-facebook-messenger
onebots -r facebook-messenger
```

The Web configuration page renders credentials, transport, filters, delivery, and advanced settings as separate sections. Webhook fields, canonical event types, and permissions are dynamic choice lists rather than hand-written JSON.

Create a Meta app with Messenger, obtain a Page Access Token for the target Page, and grant only the permissions used by the deployment. Typical permissions are `pages_messaging`, `pages_manage_metadata`, and `pages_read_engagement`; Utility Messaging additionally requires `page_utility_messaging`.

```yaml
facebook-messenger.support:
  page_id: "1234567890"
  page_access_token: ${META_PAGE_ACCESS_TOKEN}
  app_secret: ${META_APP_SECRET}
  verify_token: ${META_WEBHOOK_VERIFY_TOKEN}
  receive_mode: webhook
  http_path: /facebook-messenger/support/events
  auto_subscribe: true
  subscribed_fields:
    - messages
    - message_deliveries
    - message_reads
    - messaging_postbacks
  declared_permissions:
    - pages_messaging
    - pages_manage_metadata
    - pages_read_engagement
```

Point the Meta callback URL at the public HTTPS origin plus `http_path`. The host must preserve the exact raw request bytes for signature verification. `auto_subscribe` calls `/{page-id}/subscribed_apps`; disable it when subscriptions are managed externally, but keep `subscribed_fields` aligned with the actual upstream configuration so account capabilities stay accurate.

For an existing event consumer, select `manual` and call `ingest(rawEnvelope)`. Existing Fetch hosts can use `acceptHttp(Request)` and framework hosts can use `ingestHttp({ method, url, headers, rawBody })`. Manual mode deliberately does not accept unauthenticated HTTP.

Page IDs and PSIDs must be real decimal Meta IDs. Tokens are sent only in the Bearer header, optional `appsecret_proof` is applied, Graph paths are restricted to safe relative paths, local file paths are not read, and malformed external responses are rejected at runtime.

Official references: [Messenger Platform API](https://www.postman.com/meta/messenger-platform-api/overview) and [Graph API](https://developers.facebook.com/docs/graph-api/).
