# Mattermost configuration

## Install

```bash
pnpm add @onebots/adapter-mattermost
onebots -r mattermost
```

Create a Mattermost Bot Account or dedicated user, issue an access token, and grant only the permissions needed by the selected actions. The token is sent in the `Authorization: Bearer` header and never placed in a URL.

## Managed reliable WebSocket

```yaml
mattermost.support:
  server_url: https://mattermost.example.com
  access_token: ${MATTERMOST_TOKEN}
  receive_mode: websocket
  event_types:
    - posted
    - post_edited
    - post_deleted
    - reaction_added
    - reaction_removed
  team_ids: []
  channel_ids: []
  reconnect_initial_delay_ms: 1000
  reconnect_max_delay_ms: 30000
```

`server_url` is the instance root and may include a deployment subpath. Production URLs must use HTTPS; localhost HTTP is accepted for testing. In the Web form, event types, team IDs, and channel IDs are dynamic choice lists instead of raw JSON. Empty resource filters mean all resources.

## Existing Host or connection manager

```yaml
mattermost.embedded:
  server_url: https://mattermost.example.com
  access_token: ${MATTERMOST_TOKEN}
  receive_mode: manual
```

```ts
import { MattermostClient } from "@onebots/adapter-mattermost";

const client = new MattermostClient({
  account_id: "embedded",
  server_url: "https://mattermost.example.com",
  access_token: process.env.MATTERMOST_TOKEN!,
  receive_mode: "manual",
});

await client.start(signal);
client.on("event", delivery => dispatch(delivery));
await client.acceptSocket(existingSocket, {
  authenticate: false, // only when the Host already authenticated the connection
  owned: false,        // stop() leaves the Host socket open
}, signal);
await client.ingest(decodedMattermostWebSocketEvent);
```

`acceptSocket()` accepts an open or connecting `ws.WebSocket`. It sends the official authentication challenge unless the Host explicitly disables it. `ingest()` accepts official event envelopes, not action responses, and shares strict parsing, filtering, reliable deduplication, and canonical projection with active WebSocket delivery.

| Field | Required | Meaning |
|---|---:|---|
| `server_url` | yes | Mattermost instance root, including an optional deployment subpath |
| `access_token` | yes | Sensitive Bot Account or Personal Access Token |
| `receive_mode` | no | `websocket` (default) or `manual` |
| `event_types` | no | WebSocket event allowlist; plugin event names are accepted |
| `team_ids` | no | Restrict attributable events to selected teams |
| `channel_ids` | no | Restrict attributable events to selected channels |
| `reconnect_initial_delay_ms` | no | Initial delay for unlimited exponential reconnect |
| `reconnect_max_delay_ms` | no | Maximum reconnect delay |
| `connect_timeout_ms` | no | Handshake and WebSocket action timeout |
| `max_response_bytes` | no | REST response memory bound |

`client.call(method, path, options)` and `call_mattermost_api` only accept relative paths within the configured instance's `/api/v4`. Absolute URLs, embedded query strings, control characters, and plain or percent-encoded traversal are rejected before network I/O. Administrative and membership actions require matching permissions; Scheduled Posts also depend on server features and licensing.

See [Mattermost platform behavior](/en/platform/mattermost).
