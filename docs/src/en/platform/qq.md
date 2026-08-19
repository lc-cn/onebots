# QQ Adapter

The QQ adapter connects onebots to the QQ Official Bot platform. Since v4, it has been refactored into a thin wrapper around [`qq-official-bot`](https://www.npmjs.com/package/qq-official-bot).

## Status

✅ **Implemented and Available**

## Features

- ✅ QQ channel messages (private / public)
- ✅ QQ group messages
- ✅ C2C private messages
- ✅ channel direct messages
- ✅ channel management
- ✅ member management
- ✅ reactions and interaction notices
- ✅ WebSocket and Webhook receiver modes

## Installation

```bash
npm install @onebots/adapter-qq
# or
pnpm add @onebots/adapter-qq
```

## v4 Migration Notes

- `appId` was renamed to `appid`
- `token`, `maxRetry`, and `logLevel` were removed
- webhook mode now starts its own HTTP server inside the SDK, so `port` is required
- legacy intent names are auto-mapped, but should be updated in config files

## Configuration Example

### WebSocket mode

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  mode: 'websocket'
  sandbox: false
  intents:
    - 'GROUP_AND_C2C_EVENT'
    - 'DIRECT_MESSAGE'
    - 'GUILDS'
    - 'GUILD_MEMBERS'
    - 'GUILD_MESSAGE_REACTIONS'
    - 'INTERACTION'
    - 'PUBLIC_GUILD_MESSAGES'
    - 'FORUMS_EVENT'
```

### Webhook mode

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  mode: 'webhook'
  port: 18080
  path: '/qq/webhook'
```

In v4, webhook callbacks must point to the SDK-owned HTTP server, for example:

`http://your-server:18080/qq/webhook`

## Supported Intents

Prefer the SDK names:

| Intent | Description |
|--------|-------------|
| `GUILDS` | Channel change events |
| `GUILD_MEMBERS` | Channel member change events |
| `GUILD_MESSAGES` | Private bot channel message events |
| `PUBLIC_GUILD_MESSAGES` | Public bot channel message events |
| `GUILD_MESSAGE_REACTIONS` | Channel message reaction events |
| `DIRECT_MESSAGE` | Channel direct message events |
| `GROUP_AND_C2C_EVENT` | Group @ and C2C private message events |
| `MESSAGE_AUDIT` | Message audit events |
| `INTERACTION` | Interaction events |
| `FORUMS_EVENT` | Forum events |
| `AUDIO_ACTION` | Audio action events |

Legacy names still accepted with a warning:

| Legacy | New |
|--------|-----|
| `GROUP_AT_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT` |
| `C2C_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT` |
| `OPEN_FORUMS_EVENT` | `FORUMS_EVENT` |

## Related Links

- [QQ Adapter Configuration](/en/config/adapter/qq)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)

