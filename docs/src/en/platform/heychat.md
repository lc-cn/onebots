# Heychat Adapter

The Heychat (黑盒语音 / Heybox Chat) adapter connects to the official bot platform via WebSocket and HTTP.

## Status

✅ **Beta — core features implemented**

## Features

- WebSocket connection with heartbeat
- Slash command events (type=50)
- Channel text messages (type=5, experimental)
- Send/delete channel messages
- Room info query

## Installation

```bash
npm install @onebots/adapter-heychat
# or
pnpm add @onebots/adapter-heychat
```

## Prerequisites

1. Complete developer certification at [open.xiaoheihe.cn](https://open.xiaoheihe.cn/zh_cn/chat_robot/home)
2. Create a bot at [bot.xiaoheihe.cn](https://bot.xiaoheihe.cn) and copy the token
3. Register slash commands in the bot console
4. Invite the bot into your test room

## Configuration

```yaml
heychat.my_bot:
  token: 'your_bot_token'
  onebot.v11:
    access_token: 'your_v11_token'
```

## Start

```bash
onebots -r heychat -p onebot-v11 -c config.yaml
```

## Limitations

- Requires a long-running process (no webhook mode)
- Official docs focus on slash commands; type=5 is experimental
- Bot must be invited into the target room

## Links

- [Config reference](/en/config/adapter/heychat)
- [Official API docs](https://s.apifox.cn/43256fe4-9a8c-4f22-949a-74a3f8b431f5)
