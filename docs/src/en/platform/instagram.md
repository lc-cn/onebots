# Instagram Messaging

The Instagram adapter targets the current **Instagram API with Instagram Login / Graph v25.0**. It uses `graph.instagram.com` and Business Login for Instagram directly, requires no Facebook Page, and never opens a listener port.

Instagram Messaging is direct-only: a professional account converses with one customer per conversation. The adapter therefore does not invent group semantics. It exposes text, replies, image/video/audio, quick replies, native templates, conversations, message details, user profiles, message edits/deletes, read receipts, reactions, postbacks, referrals, and story reply context.

Named platform actions cover native Send bodies, like-heart, published-post media share, reactions, Messenger Profile, Professional Account webhook subscriptions, Welcome Message Flows, comment private replies, and the reviewed Human Agent feature. The restricted generic action accepts only safe relative Graph paths.

Human Agent remains explicit and is limited to genuine human support within seven days. A comment private reply is limited to one reply per comment within seven days; follow-ups require a user response and then follow the 24-hour window. Neither behavior silently changes ordinary message delivery.

Requests-folder conversations inactive for 30 days are omitted by the upstream API. Only the most recent 20 message details are available, and opaque cursors are not misrepresented as canonical offsets.

Webhook mode reuses the OneBots HTTP host, completes the GET challenge, and verifies `X-Hub-Signature-256` over exact POST bytes. Manual mode calls `ingest(rawEvent)`. Existing Fetch hosts use `acceptHttp(Request)`, while framework hosts use `ingestHttp()` with exact `rawBody`. All entry points share strict parsing, filtering, batch expansion, and reliable deduplication.

See [Instagram configuration](/en/config/adapter/instagram).
