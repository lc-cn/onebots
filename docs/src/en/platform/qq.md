# QQ Adapter

The QQ adapter uses Tencent's official `@tencent-connect/qqbot-nodejs` SDK. It supports C2C, group, guild-channel and guild-DM messaging while exposing the fully typed native client and authenticated OpenAPI gateway.

## Features

- WebSocket and shared-host Webhook transports
- Text, image, voice, video, file and rich messages
- Guilds, members, roles, permissions, announcements, reactions, schedules, threads and audio controls
- C2C wake-up, typing and streaming messages
- Lossless raw delivery for future Gateway events
- Unlimited connection generations after the SDK exhausts an internal retry cycle

## Configuration

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  receive_mode: websocket
  intents:
    - GROUP_AND_C2C_EVENT
    - INTERACTION
    - PUBLIC_GUILD_MESSAGES
```

Webhook mode reuses the OneBots HTTP port:

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  receive_mode: webhook
  webhook_path: '/qq/my_bot/webhook'
```

Configure `https://bot.example.com/qq/my_bot/webhook` in QQ Open Platform and preserve the raw request body for Ed25519 verification.

- [Configuration](/en/config/adapter/qq)
- [Tencent Node.js SDK](https://github.com/tencent-connect/qqbot-nodejs)
