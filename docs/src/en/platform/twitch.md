# Twitch

The Twitch adapter targets the current official Helix API and stable EventSub surface. Managed WebSocket delivery, signed Webhooks, an existing HTTP Host, upgraded sockets, and `ingest(rawEvent)` converge on one `TwitchClient`; the SDK opens no private listener and does not advertise Beta semantics as stable support.

Broadcaster channels map to canonical groups/channels, channel chat to channel messages, and whispers to direct messages. Mention, emote, cheermote, GIF, and reply fragment semantics are preserved. Twitch Chat has no media upload, so public media URLs are explicitly compiled to text. Unknown or externally supplied EventSub types retain their complete `raw_event` and Twitch extensions in a custom notice.

In WebSocket mode, subscriptions are created only after the official welcome. A `reconnect_url` performs a lossless handoff before the old socket closes and does not duplicate subscriptions; ordinary disconnects receive a new session, recreate subscriptions, and retry forever with bounded exponential backoff. Webhook mode validates the raw-body HMAC, timestamp window, challenge, size bound, and duplicates on the shared OneBots HTTP Host. Manual mode validates OAuth identity without starting a transport, then accepts `acceptHttp()`, `acceptSocket()`, or `ingest()` input through the same strict parser and reliable ingress.

Drops and Extension Bits enforce their official Webhook-only transport. Batched Drops `events` retain their envelope, dispatch under one idempotency transaction, and receive collision-free canonical IDs through their batch indexes.

Canonical actions cover channel and direct messages, deletion, channel/chatter lookup, timeout/ban, moderators, announcements, status, and version. Native platform actions add chat settings, warnings, Automod, VIPs, blocked terms, rewards, polls, predictions, raids, streams, clips, schedules, videos, games, emotes, cheermotes, and EventSub management. `call_twitch_api` remains a constrained relative-path escape hatch for the remaining Helix surface.

The account capability manifest is narrowed by validated OAuth scopes and configured subscriptions. Stable types, versions, condition profiles, transport restrictions, and batching rules come from one EventSub catalog shared by runtime validation and the Web form.

See [Twitch configuration](/en/config/adapter/twitch). Official references: [Helix API](https://dev.twitch.tv/docs/api/reference), [EventSub](https://dev.twitch.tv/docs/eventsub/), [Subscription Types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/), and [OAuth Scopes](https://dev.twitch.tv/docs/authentication/scopes/).
