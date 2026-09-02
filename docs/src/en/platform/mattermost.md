# Mattermost

The Mattermost adapter targets the current Mattermost Server REST API v4 and official WebSocket protocol. REST calls, an actively managed reliable WebSocket, externally owned sockets, and low-level `ingest(rawEvent)` share one `MattermostClient`; the SDK never opens another listener.

## Resource mapping

- Direct channels (`D`) map to `direct`.
- Group Message channels (`G`) map to `group`.
- Public and private channels (`O` / `P`) map to `channel`.
- Teams map to `guild`.
- Posts, threads, files, and reactions map to canonical messages, thread segments, file segments, and reaction notices.

Mattermost fixes GDM membership when the channel is created, so the adapter does not emulate nonexistent GDM membership mutation. Team and channel member methods traverse every REST page instead of silently stopping at the 200-item server limit.

## Delivery and recovery

`websocket` connects to the instance's `/api/v4/websocket`, sends the official `authentication_challenge`, and retries forever with bounded exponential backoff. Reconnect URLs include `connection_id` and the last observed `sequence_number`; gaps raise the typed `missed` event. `manual` performs REST identity verification without opening a socket, then accepts an existing socket through `acceptSocket()` or decoded official envelopes through `ingest()`.

An `AbortSignal` remains attached after the initial handshake and ends the complete lifecycle. An external socket with `owned: false` is unbound but not closed. Stringified event entities are parsed and runtime-validated, downstream failures remain retryable, and unknown plugin or future events retain the complete `raw_event` in a canonical custom notice.

High-value native actions cover post search, ephemeral and scheduled posts, DM/GDM, channel/team/member management, status and typing, channel bookmarks, custom emoji, bot accounts, slash commands, plus a constrained relative-path `call_mattermost_api`. Administrative actions depend on token permissions; Scheduled Posts depend on server features and licensing. Account capabilities are narrowed by configured event filters, receive mode, and current socket availability.

See [Mattermost configuration](/en/config/adapter/mattermost). Official references: [REST API](https://api.mattermost.com/), [WebSocket API](https://developers.mattermost.com/integrate/reference/websocket/), and [Bot Accounts](https://developers.mattermost.com/integrate/reference/bot-accounts/).
