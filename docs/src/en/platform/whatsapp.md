# WhatsApp Platform

The adapter uses Meta's official WhatsApp Cloud API, receives signed webhooks through the shared OneBots HTTP host, and calls the versioned Graph API for outbound operations.

## Coverage

- Text, replies, images, video, audio, documents, stickers, locations, contacts, and reactions
- Native Template, Interactive, Flow, and future Cloud API message payloads
- Complete message-status projection with the original webhook change preserved
- Media upload, metadata lookup, authenticated download, and deletion
- Business profile, phone registration, two-step verification, blocked users, and templates
- Generic `whatsapp_call` for newly introduced Graph API resources
- `WhatsAppClient.ingest(rawEvent)` for feeding an existing trusted connection into the same client

Cloud API does not expose ordinary WhatsApp groups, contact lists, or arbitrary message history, so the adapter does not emulate those capabilities.

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

Use a `whatsapp_message` segment for Template, Interactive, Flow, or any other native message payload. Platform actions expose common operations, while `whatsapp_call` accepts a safe relative Graph API resource:

```ts
await adapter.callAction("my_bot", "whatsapp_call", {
  method: "GET",
  resource: "your-waba-id/message_templates",
  query: { limit: 50 },
});
```

Absolute resource URLs are rejected so the access token cannot be sent to an unconfigured host. Permission-dependent actions declare either `whatsapp_business_management` or `whatsapp_business_messaging` in the capability manifest.

Meta manages the Graph API lifecycle, so `api_version` must explicitly match a version enabled for the app.

References: [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/), [Meta official Postman workspace](https://www.postman.com/meta/whatsapp-business-platform/overview/).
