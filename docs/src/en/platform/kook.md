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

```typescript
import { ImHelper } from 'imhelper';
import { OneBotV11Adapter } from '@imhelper/onebot-v11';

const client = new ImHelper();

// Register OneBot V11 protocol adapter
client.registerAdapter('onebot.v11', OneBotV11Adapter);

// Connect to onebots server
await client.connect({
  platform: 'kook',
  account_id: 'my_bot',
  protocol: 'onebot.v11',
  endpoint: 'ws://localhost:6727/kook/my_bot/onebot/v11/ws',
  access_token: 'your_access_token',
});

// Listen for messages
client.on('message', (message) => {
  console.log(`Received message: ${message.content}`);
  // Auto reply
  message.reply('Hello from Kook bot!');
});
```

## Related Links

- [Kook Adapter Configuration](/en/config/adapter/kook)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)

