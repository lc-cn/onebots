# Telegram Adapter

The Telegram adapter is fully implemented and supports connecting to onebots service through Telegram Bot API.

## Status

✅ **Implemented and Available**

## Features

- ✅ **Message Sending/Receiving**
  - Private chat message sending/receiving
  - Group message sending/receiving
  - Channel message sending/receiving
  - Supports text, images, video, audio, files, and other message formats
- ✅ **Message Management**
  - Message editing
  - Message deletion
- ✅ **Group Management**
  - Get group information
  - Get group member list and information
  - Leave group
  - Kick members
- ✅ **Interactive Features**
  - Inline Keyboard
  - Callback Query
  - Command handling (/command)
- ✅ **Connection Modes**
  - Polling mode (default)
  - Webhook mode

## Installation

```bash
npm install @onebots/adapter-telegram grammy
# or
pnpm add @onebots/adapter-telegram grammy
```

## Configuration

Configure Telegram account in `config.yaml`:

```yaml
# Telegram bot account configuration
telegram.your_bot_id:
  # Telegram platform configuration
  token: 'your_telegram_bot_token'  # Telegram Bot Token, required
  
  # Polling mode (default)
  polling:
    enabled: true  # Whether to enable polling, default true
    timeout: 30    # Polling timeout (seconds)
    limit: 100     # Number of updates to fetch per request
    allowed_updates: ['message', 'callback_query']  # Allowed update types
  
  # Or Webhook mode
  # webhook:
  #   url: 'https://your-domain.com/webhook'
  #   secret_token: 'your_secret_token'  # Optional, webhook secret
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
```

## Client SDK Usage

Connect the client to the complete account protocol root, for example `http://localhost:6727/telegram/{account_id}/onebot/v12`. See the [Client SDK Guide](/en/guide/client-sdk) for Client creation, receive modes, existing-Host integration, and API calls.

## Related Links

- [Telegram Adapter Configuration](/en/config/adapter/telegram)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)
