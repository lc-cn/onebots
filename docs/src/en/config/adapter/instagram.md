# Instagram Messaging configuration

Install and load the adapter:

```bash
pnpm add @onebots/adapter-instagram
onebots -r instagram
```

Create a Meta app with Business Login for Instagram. Request the current `instagram_business_basic` and `instagram_business_manage_messages` scopes. This adapter deliberately does not accept the deprecated pre-2025 `business_*` scopes or require a Facebook Page Access Token.

```yaml
instagram.support:
  instagram_user_id: "1234567890"
  access_token: ${INSTAGRAM_ACCESS_TOKEN}
  app_secret: ${META_APP_SECRET}
  verify_token: ${META_WEBHOOK_VERIFY_TOKEN}
  receive_mode: webhook
  http_path: /instagram/support/events
  auto_subscribe: true
  subscribed_fields:
    - messages
    - messaging_postbacks
    - messaging_seen
    - message_reactions
  declared_permissions:
    - instagram_business_basic
    - instagram_business_manage_messages
```

`instagram_user_id` is the professional account's decimal Meta ID, not its username. The Web form separates credentials, transport, filters, and advanced settings. Webhook fields, event types, and permissions are dynamic choice lists rather than hand-written JSON.

Point the Meta callback URL at the public HTTPS origin plus `http_path`. Preserve exact raw request bytes for signature verification. `auto_subscribe` calls `/{instagram-user-id}/subscribed_apps`; when subscriptions are managed externally, disable it but keep `subscribed_fields` aligned with upstream reality so account capabilities remain accurate.

For an existing consumer, use `receive_mode: manual` and call `ingest(rawEnvelope)`. Existing Fetch hosts can use `acceptHttp(Request)` and framework hosts can use `ingestHttp({ method, url, headers, rawBody })`.

User Profile access requires prior user consent through a message, Ice Breaker, or Persistent Menu. Comment private replies also require `instagram_business_manage_comments`; Human Agent is a separately reviewed feature. Tokens stay in Bearer headers, optional `appsecret_proof` is applied, Graph paths are restricted, local paths are not read, and malformed external payloads are rejected at runtime.

Official reference: [Instagram API](https://www.postman.com/meta/instagram/overview).
