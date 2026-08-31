# Facebook Messenger

The Facebook Messenger adapter targets the current stable Messenger Platform and Graph v25.0. Its embeddable `FacebookMessengerClient` owns Graph calls, strict external-data validation, webhook signatures, batch expansion, reliable deduplication, and event projection without opening a port.

## Capability mapping

| Messenger Platform | OneBots |
|---|---|
| Send API and sender actions | Send messages, mark seen, typing state |
| Attachment Upload | Image, video, audio, and file upload |
| Conversations and Messages | Message lookup and direct-message history |
| User and Page Profile | User details and bot identity |
| Message/edit/delivery/read/reaction/postback | Canonical message, status, reaction, and interaction events |
| Referral/opt-in/handover/policy/feedback | `custom` events with the complete `raw_event` |

Messenger Page-to-PSID conversations are direct only. The adapter does not invent group semantics. It also rejects canonical offset pagination where Messenger only provides opaque cursors.

Named platform actions cover native messages, sender actions, attachments, conversations, Messenger Profile, Page subscriptions, moderation, Handover Protocol, and Utility Messaging template management and delivery. The restricted generic action accepts only safe relative Graph paths.

Utility Messaging requires `page_utility_messaging` and remains subject to Meta's supported-region, non-marketing, and template-review rules. It is intentionally separate from the default messaging type.

Webhook mode reuses the OneBots HTTP host, completes the GET challenge, and verifies `X-Hub-Signature-256` over the exact POST bytes. Manual mode accepts an already decoded envelope through `ingest(rawEvent)`. Existing Fetch hosts can call `acceptHttp(Request)`, while framework hosts can call `ingestHttp()` with the exact `rawBody`. A delivery is committed only after all asynchronous consumers succeed.

See [Facebook Messenger configuration](/en/config/adapter/facebook-messenger).
