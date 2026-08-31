# Matrix

The Matrix adapter implements the current stable Matrix v1.19 Client-Server and Application Service APIs. A single embeddable `MatrixClient` owns transport, validation, ordering and deduplication; it never opens a separate listener.

## Mapping

| Matrix | OneBots |
| --- | --- |
| Room | `group`; rooms discovered through `m.direct` use `direct` |
| `m.room.message` / `m.sticker` | Message and media segments |
| `m.replace` | `message_updated` |
| `m.reaction` / reaction redaction | `reaction_added` / `reaction_removed` |
| `m.room.redaction` | `message_deleted` |
| `m.room.member` | Membership notices and room invitations for the bot |
| `m.typing`, `m.receipt`, `m.presence` | Typing, receipt and presence notices |
| Unknown, to-device, account-data and encrypted events | `custom` with the complete `raw_event` |

Member roles are projected from `m.room.power_levels`: 100+ is owner, 50–99 is admin, and lower levels are members. Native calls cover messages, context/history, profiles, summaries, membership, edits, redactions, reactions, read receipts, state and authenticated media uploads.

Because `m.typing` is a room snapshot, the Client retains the previous snapshot and emits precise started/stopped deltas. `m.direct` is also treated as a complete account-data snapshot, so removed direct rooms do not remain cached.

## Receive modes

- `sync` performs cancellable `/_matrix/client/v3/sync` long polling. It commits `next_batch` only after delivery and retries forever with bounded exponential backoff.
- `appservice` handles standard v1 transactions and ping requests on the existing OneBots Host. It requires a Bearer `hs_token`; a downstream failure returns HTTP 500 so the homeserver can retry the same transaction.
- `manual` creates no receiver and mounts no route. Existing connections call `await client.ingest(rawEvent)`, Fetch-compatible hosts call `acceptHttp(request)`, and other hosts use the structured `ingestHttp()` result.

All modes share the same reliable event pipeline. A listener failure never commits the event or transaction deduplication key.

The adapter also exposes constrained native actions for room creation/join/knock, state, bans, presence, typing, read markers, public rooms, AppService ping and a generic relative-path `call_matrix_api` escape hatch.

## Encryption boundary

`m.room.encrypted` is never guessed into plaintext. Ciphertext remains available as a `custom` raw event; Olm/Megolm key management is explicitly not claimed. An existing encrypted Matrix client can decrypt events and feed them into the same client through manual ingest.

See [Matrix configuration](/en/config/adapter/matrix).
