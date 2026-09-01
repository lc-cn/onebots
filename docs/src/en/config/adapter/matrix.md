# Matrix configuration

## Client `/sync`

```yaml
matrix.bot:
  homeserver_url: https://matrix.example.com
  user_id: "@onebots:example.com"
  access_token: your-access-token
  receive_mode: sync
  event_types:
    - m.room.message
    - m.reaction
    - m.room.redaction
    - m.room.member
    - m.typing
    - m.receipt
    - m.direct
  sync_timeout_ms: 30000
  sync_retry_min_ms: 1000
  sync_retry_max_ms: 60000
```

Startup calls `whoami` and rejects credentials whose identity differs from `user_id`. The Web form renders Matrix event types as an add/remove choice list and generates the `/sync` filter directly.

`whoami`, asynchronous ready listeners, `/sync` long polling, and subsequent protocol outlets share the account startup boundary. When the global `timeout` expires or a hot reload is cancelled, the adapter aborts pending identity and sync requests. Connection-generation checks prevent a late response that ignored cancellation from restoring account state.

## Application Service

```yaml
matrix.bridge:
  homeserver_url: https://matrix.example.com
  user_id: "@onebots:example.com"
  receive_mode: appservice
  appservice_id: onebots
  as_token: your-as-token
  hs_token: your-hs-token
  appservice_path: /matrix/bridge/appservice
```

Homeserver registration:

```yaml
id: onebots
url: https://gateway.example.com/matrix/bridge/appservice
as_token: your-as-token
hs_token: your-hs-token
sender_localpart: onebots
rate_limited: false
receive_ephemeral: true
namespaces:
  users: []
  aliases: []
  rooms: []
```

The homeserver appends the standard `/_matrix/app/v1/...` routes to `url`. OneBots does not claim virtual namespaces: user and room queries return `M_NOT_FOUND`. A bridge that owns namespaces should implement those queries itself and forward transactions through manual/existing-Host ingress. Hot reload resolves the current Client at request time instead of retaining a stopped instance.

## Existing Host or connection

Set `receive_mode: manual`, then use the exported standalone client:

```ts
import { MatrixClient } from "@onebots/adapter-matrix";

const client = new MatrixClient(config);
await client.ingest({ event: decryptedEvent, room_id, section: "manual" });

// Existing Fetch/WinterCG Application Service Host:
const response = await client.acceptHttp(request);
```

Manual mode starts no `/sync` loop and mounts no route. `acceptHttp()` follows the current specification and requires the Bearer `hs_token`; query-only legacy authentication is deliberately not accepted.

`upload_file` accepts only base64 `data` already read by the host (up to 100 MiB). It deliberately does not read local paths or fetch remote URLs, preventing local-file disclosure and SSRF through the gateway.
