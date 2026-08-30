# Zulip

The Zulip adapter implements the current REST API and the official Event Queue protocol (`POST /register`, followed by long-polling `GET /events`). It does not open a non-existent Zulip WebSocket endpoint.

## Mapping

| Zulip | OneBots |
| --- | --- |
| Channel + topic | `group` / `channel`, scene ID `stream_id/topic` |
| Direct message | `private`, one user ID or comma-separated user IDs |
| Organization user | User, not a fabricated friend |
| Channel subscribers | Group members |
| Reaction | `reaction_added` / `reaction_removed` |
| Other queue events | `custom`, with the complete `raw_event` |

Text uses Zulip-flavored Markdown. Mentions resolve the real member name and ID. Remote media is linked directly; local paths and Base64 payloads are uploaded through `/user_uploads`. Message fetch, history, edits, deletion, read flags, reactions, channel membership, and file uploads use native endpoints.

The queue is recreated after `BAD_EVENT_QUEUE_ID`, retries forever with bounded exponential backoff, is cancelled through `AbortSignal`, and is deleted on shutdown. A consumer listener exception is reported as a structured client error without stopping queue consumption.

The package exports a standalone typed `ZulipClient`. Existing queue consumers can feed events through `await client.ingest(rawEvent)`; deduplication is committed only after every raw, typed, and canonical listener completes. `client.call(path, method, params)` provides a constrained escape hatch for official API endpoints under the configured organization.

See [Zulip configuration](/en/config/adapter/zulip) and the package README for the complete native action list.
