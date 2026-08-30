# Slack Adapter

The Slack adapter is fully implemented and supports connecting to onebots service through Slack Bot API.

## Status

✅ **Implemented and Available**

## Features

- ✅ **Message Sending/Receiving**
  - Channel message sending/receiving
  - One-to-one and multi-person direct messages (MPIM)
  - Text, files, threads, Block Kit, and streaming messages
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
  - Socket Mode, HTTP Events, and manual ingestion
  - Acknowledgement only after synchronous and asynchronous listeners succeed
- ✅ **Extended Features**
  - App commands (Slash Commands, requires additional configuration)
  - Interactive components, Canvas, Modal, and App Home

## Installation

```bash
npm install @onebots/adapter-slack
# or
pnpm add @onebots/adapter-slack
```

## Configuration

Configure Slack account in `config.yaml`:

```yaml
# Slack bot account configuration
slack.your_bot_id:
  # Slack platform configuration
  token: 'xoxb-your-bot-token'  # Slack Bot Token, required
  receive_mode: socket  # socket (default), webhook, or manual
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
import { createOnebot12Client } from '@imhelper/onebot-v12';

const client = createOnebot12Client({
  baseUrl: 'http://localhost:6727/slack/your_bot_id/onebot/v12',
  selfId: 'your_bot_id',
  accessToken: 'your_access_token',
  receiveMode: 'ws',
});

client.on('message.channel', async message => {
  await message.reply('Received!');
});

await client.start();
```

## Related Links

- [Slack Adapter Configuration](/en/config/adapter/slack)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)
