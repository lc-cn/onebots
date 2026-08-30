# Kook Adapter

The Kook adapter supports connecting to onebots service through Kook Open Platform API.

## Status

✅ **Implemented and Available**

## Features

- ✅ Channel Messages
- ✅ Private Chat Messages
- ✅ Server Management
- ✅ Member Management
- ✅ Rich Text Messages
- ✅ Card Messages

## Installation

```bash
npm install @onebots/adapter-kook
# or
pnpm add @onebots/adapter-kook
```

## Configuration Example

```yaml
kook.my_bot:
  # Protocol configuration
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: 'your_token'
  
  # Kook platform configuration
  token: 'your_kook_bot_token'
```

## Client SDK Usage

Connect the client to the complete account protocol root, for example `http://localhost:6727/kook/{account_id}/onebot/v12`. See the [Client SDK Guide](/en/guide/client-sdk) for Client creation, receive modes, existing-Host integration, and API calls.

## Related Links

- [Kook Adapter Configuration](/en/config/adapter/kook)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)
