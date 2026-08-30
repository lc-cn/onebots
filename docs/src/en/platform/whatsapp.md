# WhatsApp Platform

The adapter uses Meta's official WhatsApp Cloud API, receives signed webhooks through the shared OneBots HTTP host, and calls the versioned Graph API for outbound operations.

## Coverage

- Private and Groups API messages with text, replies, images, video, audio, documents, stickers, locations, contacts, and reactions
- Native Template, Interactive, Flow, and future Cloud API message payloads
- Complete message-status projection with the original webhook change preserved
- Media upload, metadata lookup, authenticated download, and deletion
- Business profile, commerce, Flow lifecycle, phone registration, two-step verification, blocked users, and templates
- Groups API metadata and participants, settings, invite links, join approvals, and lifecycle/status webhooks
- Generic `whatsapp_call` for newly introduced Graph API resources
- `await WhatsAppClient.ingest(rawEvent)` for feeding an existing trusted connection into the same client, with deduplication committed only after all synchronous/asynchronous listeners succeed

Groups API is limited to eligible Official Business Accounts and groups created and managed by the current Phone Number through that API; it does not expose ordinary consumer groups. Cloud API also does not expose contact lists or arbitrary message history, so the adapter does not emulate those capabilities.

## Configuration

```yaml
whatsapp.my_bot:
  phone_number_id: "your_phone_number_id"
  business_account_id: "your_business_account_id"
  access_token: "your_long_lived_access_token"
  app_secret: "your_meta_app_secret"
  webhook_verify_token: "your_random_verify_token"
  api_version: "v23.0"
```

See the [configuration reference](/en/config/adapter/whatsapp) for all fields.

## Native payloads and APIs

Use a `whatsapp_message` segment for Template, Interactive, Flow, or any other native message payload. Platform actions expose business profile, commerce, and Flow lifecycle operations, while `whatsapp_call` accepts a safe relative Graph API resource:

```ts
await adapter.callAction("my_bot", "whatsapp_call", {
  method: "GET",
  resource: "your-waba-id/message_templates",
  query: { limit: 50 },
});
```

Absolute resource URLs are rejected so the access token cannot be sent to an unconfigured host. Permission-dependent actions declare either `whatsapp_business_management` or `whatsapp_business_messaging` in the capability manifest.

Fixed Groups actions cover create/get/list/update/delete, invite links, join-request approval, participant add/remove, and message pin/unpin. Subscribe the v23 fields `group_lifecycle_update`, `group_participant_update`, and `group_settings_update` in addition to `messages` when Groups API is enabled.

Message QR codes are available through `client.qrCodes` and the five fixed QR-code actions. Field selection uses an array, PNG/SVG image projection is explicit, and list queries support code filtering, a 1–25 limit, and cursor pagination. Requests and responses are validated against the Meta v23 shapes, including the single-item `data` array.

Message templates are managed through `client.messageTemplates`, with fixed actions for listing, lookup by ID, namespace discovery, creation, editing, and deletion by name or template ID. Top-level fields and responses are validated, while typed components retain Meta's evolving OTP, Flow, Catalog, MPM, and media-handle JSON fields through a safe serializable extension surface.

Meta manages the Graph API lifecycle, so `api_version` must explicitly match a version enabled for the app.

References: [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/), [Meta official Postman workspace](https://www.postman.com/meta/whatsapp-business-platform/overview/).
