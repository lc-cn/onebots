# Zulip configuration

## Credentials

| Field | Type | Description |
| --- | --- | --- |
| `server_url` | string | Organization root URL, such as `https://example.zulipchat.com` |
| `email` | string | Bot API email |
| `api_key` | string | Bot API key; rendered as a sensitive field in the Web UI |

Do not append `/api/v1` to `server_url`. The old `serverUrl`, `apiKey`, and `websocket` fields were removed: Zulip's real-time protocol is the long-polling Event Queue API, not WebSocket.

```yaml
zulip.team-bot:
  server_url: https://example.zulipchat.com
  email: onebots-bot@example.zulipchat.com
  api_key: your-api-key
  default_topic: general
  receive_mode: event_queue
  event_queue:
    event_types:
      - message
      - update_message
      - delete_message
      - reaction
      - subscription
      - realm_user
    all_public_streams: false
    retry_initial_delay_ms: 1000
    retry_max_delay_ms: 30000
  onebot.v11:
    access_token: your-token
```

The Web form can add and remove event types directly. `receive_mode` is either `event_queue` (default) or `manual`; the removed `event_queue.enabled` field is not accepted. Reconnection is always unlimited; the delay grows exponentially from `retry_initial_delay_ms` up to `retry_max_delay_ms`.

Manual mode does not register or poll a queue. Existing consumers call `await client.ingest(rawEvent)`; deduplication is committed only after raw, typed, canonical, and protocol delivery succeeds.

Optional HTTP(S) and SOCKS proxy settings are available under `proxy.url`, `proxy.username`, and `proxy.password`. Missing proxy support fails startup explicitly instead of silently using a direct connection.

See [Zulip platform support](/en/platform/zulip) for scene IDs and native actions.
