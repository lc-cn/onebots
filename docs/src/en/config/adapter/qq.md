# QQ Adapter Configuration

QQ Official Bot adapter configuration guide (based on the [qq-official-bot](https://www.npmjs.com/package/qq-official-bot) SDK).

## Configuration Format

```yaml
qq.{account_id}:
  # QQ platform configuration
  appid: 'your_app_id'           # Required: QQ Bot AppID (renamed to `appid` in v4)
  secret: 'your_secret'          # Required: QQ Bot Secret
  mode: 'websocket'              # Optional: Connection mode, 'websocket' (default) or 'webhook'
  sandbox: false                 # Optional: Sandbox environment, default false
  intents:                       # Optional: Events to listen to (WebSocket mode only)
    - 'GROUP_AND_C2C_EVENT'      # Group @ + private chat events (legacy GROUP_AT_MESSAGE_CREATE / C2C_MESSAGE_CREATE deprecated)
    - 'DIRECT_MESSAGE'           # Channel direct message event
    - 'GUILDS'                   # Channel change event
    - 'GUILD_MEMBERS'            # Channel member change event
    - 'GUILD_MESSAGE_REACTIONS'  # Channel message reaction event
    - 'INTERACTION'              # Interaction event
    - 'PUBLIC_GUILD_MESSAGES'    # Public bot channel message event
    - 'FORUMS_EVENT'             # Forum event (legacy OPEN_FORUMS_EVENT deprecated)
  # Webhook-mode specific
  port: 18080                    # Required for webhook mode: SDK listens on this port (different from onebots main port)
  path: '/qq/webhook'            # Optional: webhook path, default '/'
  apiBaseUrl: 'https://api.bot.qq.com'  # Optional: advanced, override API base URL

  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
  onebot.v12:
    access_token: 'your_v12_token'
```

## Configuration Fields

| Field | Type | Required | Description | Default |
|-------|------|----------|-------------|---------|
| `appid` | string | Yes | QQ Bot AppID (renamed in v4) | - |
| `secret` | string | Yes | QQ Bot Secret | - |
| `mode` | string | No | Connection mode: `websocket` (default) or `webhook` | `websocket` |
| `sandbox` | boolean | No | Sandbox environment | `false` |
| `intents` | string[] | No | Events to listen to (WebSocket mode only) | `[]` |
| `apiBaseUrl` | string | No | Override API base URL (advanced, overrides `sandbox`) | - |
| `port` | number | Required for webhook | SDK listens on this port (must differ from onebots main port) | - |
| `path` | string | No | Webhook path | `/` |

## Intent Description

Intents use SDK names from `qq-official-bot`:

| Value | Description |
|-------|-------------|
| `GUILDS` | Channel change event |
| `GUILD_MEMBERS` | Channel member change event |
| `GUILD_MESSAGES` | Private bot channel message event |
| `PUBLIC_GUILD_MESSAGES` | Public bot channel message event |
| `GUILD_MESSAGE_REACTIONS` | Channel message reaction event |
| `DIRECT_MESSAGE` | Channel direct message event |
| `GROUP_AND_C2C_EVENT` | Group @ + private chat event (merged in v4) |
| `MESSAGE_AUDIT` | Message audit event |
| `INTERACTION` | Interaction event |
| `FORUMS_EVENT` | Forum event |
| `AUDIO_ACTION` | Audio action event |

Legacy names (a one-time warning is logged at startup; auto-mapped to the new names):

| Legacy | New |
|--------|-----|
| `GROUP_AT_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT` |
| `C2C_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT` |
| `OPEN_FORUMS_EVENT` | `FORUMS_EVENT` |

## Connection Modes

### WebSocket mode (default)

The bot actively connects to QQ servers and receives events in real time.

```yaml
qq.my_bot:
  mode: 'websocket'  # optional, default
  intents:
    - 'GROUP_AND_C2C_EVENT'
    - 'PUBLIC_GUILD_MESSAGES'
```

### Webhook mode (v4 behavior change)

> ⚠️ **v4 changed webhook behavior**: the SDK spins up its own HTTP server and no longer mounts a route on the onebots main router.

```yaml
qq.my_bot:
  mode: 'webhook'
  port: 18080               # required, port the SDK listens on (must differ from onebots main port)
  path: '/qq/webhook'       # optional, default '/'
```

Event push URL (configure in the QQ Open Platform console): `http://<your-host>:18080/qq/webhook`

Notes:

- `port` is required; missing it will throw at startup
- The webhook server must be reachable from QQ (use reverse proxy or public tunnel as needed)

## Complete Example

```yaml
port: 6727
log_level: info
timeout: 30

general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000

# QQ Official Bot account configuration
qq.my_bot:
  # QQ platform configuration
  appid: 'your_app_id'         # renamed to `appid` in v4
  secret: 'your_secret'
  sandbox: false
  intents:
    - 'GROUP_AND_C2C_EVENT'
    - 'PUBLIC_GUILD_MESSAGES'

  # OneBot V11 protocol configuration
  onebot.v11:
    access_token: 'qq_token'
```

## v3 → v4 Migration

| v3 | v4 |
|----|----|
| `appId` | `appid` (lowercase d) |
| `token` | Removed (handled by SDK) |
| `maxRetry` | Removed (handled by SDK) |
| `logLevel` | Removed (handled by SDK) |
| Webhook mounted on onebots main router `/qq/{account_id}/webhook` | Standalone HTTP server `http://host:{port}/{path}`, `port` is required |
| Legacy intent names (`GROUP_AT_MESSAGE_CREATE`, etc.) | SDK names (`GROUP_AND_C2C_EVENT`, etc.); legacy names still accepted with a one-time warning |

## Related Links

- [QQ Platform](/en/platform/qq)
- [Quick Start](/en/guide/start)