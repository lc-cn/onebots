# Slack Adapter

The Slack adapter is fully implemented and supports connecting to onebots service through Slack Bot API.

## Status

✅ **Implemented and Available**

## Features

- ✅ **Message Sending/Receiving**
  - Channel message sending/receiving
  - Private chat message sending/receiving
  - Supports text, rich text (Blocks), and other message formats
- ✅ **Message Management**
  - Message editing
  - Message deletion
- ✅ **Channel Management**
  - Get channel list and information
  - Leave channel
  - Get channel member list
- ✅ **User Management**
  - Get user information
- ✅ **Event Subscription**
  - Events API support
  - Webhook event subscription
- ✅ **Extended Features**
  - App commands (Slash Commands, requires additional configuration)
  - Interactive components (requires additional configuration)

## Installation

```bash
npm install @onebots/adapter-slack @slack/web-api
# or
pnpm add @onebots/adapter-slack @slack/web-api
```

## Configuration

Configure Slack account in `config.yaml`:

```yaml
# Slack bot account configuration
slack.your_bot_id:
  # Slack platform configuration
  token: 'xoxb-your-bot-token'  # Slack Bot Token, required
  receive_mode: socket  # socket (default) or webhook
  app_token: 'xapp-your-app-token'  # Required in Socket Mode
  
  # OneBot V11 protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
  
  # OneBot V12 protocol configuration
  onebot.v12:
    access_token: 'your_v12_token'
```

## Client SDK Usage

```typescript
import { ImHelper } from 'imhelper';
import { OneBotV11Adapter } from '@imhelper/onebot-v11';

const client = new ImHelper();

// Register OneBot V11 protocol adapter
client.registerAdapter('onebot.v11', OneBotV11Adapter);

// Connect to onebots server
await client.connect({
  platform: 'slack',
  account_id: 'your_bot_id',
  protocol: 'onebot.v11',
  endpoint: 'ws://localhost:6727/slack/your_bot_id/onebot/v11/ws',
  access_token: 'your_access_token',
});
```

## Related Links

- [Slack Adapter Configuration](/en/config/adapter/slack)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)
