# DingTalk Adapter

The DingTalk adapter is fully implemented and supports connecting to onebots service through DingTalk bot.

## Status

✅ **Implemented and Available**

## Features

### Enterprise Internal App Mode

- ✅ **Message Sending/Receiving**
  - Private chat message sending/receiving
  - Group chat message sending/receiving
  - Supports text, Markdown, cards, and other message formats
- ✅ **User Management**
  - Get user information
- ✅ **Event Subscription**
  - Webhook event subscription
  - Automatic token management

### Custom Bot Mode (Webhook)

- ✅ **Group Chat Message Push**
  - Text messages
  - Markdown messages
  - @user, @all
  - Card messages (partial support)

## Installation

```bash
npm install @onebots/adapter-dingtalk
# or
pnpm add @onebots/adapter-dingtalk
```

## Configuration

### Enterprise Internal App Mode

Configure in `config.yaml`:

```yaml
# DingTalk enterprise internal app bot configuration
dingtalk.your_bot_id:
  # DingTalk platform configuration
  app_key: 'your_app_key'  # App AppKey, required
  app_secret: 'your_app_secret'  # App AppSecret, required
  agent_id: 'your_agent_id'  # Optional, enterprise internal app AgentId
  encrypt_key: 'your_encrypt_key'  # Optional, event encryption key
  token: 'your_token'  # Optional, event verification Token
  
  # OneBot V11 protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
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
  platform: 'dingtalk',
  account_id: 'your_bot_id',
  protocol: 'onebot.v11',
  endpoint: 'ws://localhost:6727/dingtalk/your_bot_id/onebot/v11/ws',
  access_token: 'your_access_token',
});
```

## Related Links

- [DingTalk Adapter Configuration](/en/config/adapter/dingtalk)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)

