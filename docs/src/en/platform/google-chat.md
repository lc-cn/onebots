# Google Chat

The Google Chat adapter targets the current stable REST v1, Chat interaction event, and Google Workspace Events APIs. One embeddable `GoogleChatClient` owns authentication, strict external-data validation, deduplication, and canonical projection; it never opens a listener.

## Capability mapping

| Google Chat | OneBots |
|---|---|
| Message create/get/list/patch/delete | Send, inspect, list, edit, and delete messages |
| Space list/get/patch | Group list, details, and rename |
| Membership list/create/delete | Member lookup, invite, remove, and leave |
| Reaction create/delete | Message reactions |
| Attachment upload/download | User-auth `upload_file` and typed `downloadMedia()` |
| Space/thread read state | `message_status` events and user-auth read markers |
| Interaction cards, commands, and dialogs | Canonical `custom` events with lossless `raw_event` |
| Workspace resource events | Canonical message and notice events |

Google Chat has no general `users.get`. `get_user_info` only returns a strictly parsed user observed in an interaction, message, or membership. For Workspace messages that only identify their Space by name, the client calls `spaces.get` to close the direct/group scene instead of guessing.

The closed native action set includes safe relative REST calls, direct/group-chat lookup, space setup/create/delete, Space event queries, availability transitions, read-state lookups, reactions, and rich cardsV2 messages. Developer Preview message pins and custom emoji are deliberately not advertised as stable named actions; preview participants can opt into their version risk through `call_google_chat_api`.

An app leaves a Space through the official `spaces/{space}/members/app` resource. A user-auth `principal_name` used by `leave_group` must be a resolvable `users/{id|email}` rather than the `users/me` alias, which cannot identify a membership resource. Upload uses user OAuth; typed `downloadMedia()` returns the original bytes.

Interaction HTTP validates Google Chat's OIDC or self-signed JWT identity and can return a synchronous structured response. Pub/Sub push validates the configured push service account, expands batches, and acknowledges only after downstream listeners succeed. Existing hosts and consumers use the same client through manual `ingest()`.

See [Google Chat configuration](/en/config/adapter/google-chat).
