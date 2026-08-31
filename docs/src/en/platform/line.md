# Line Adapter

The Line adapter supports connecting to onebots service through the Line Messaging API.

## Status

✅ **Implemented and Available**

## Features

- ✅ **Message Sending/Receiving**
  - Private chat message sending/receiving
  - Group message sending/receiving
  - Room message sending/receiving
  - Supports text, images, video, audio, files, location, stickers, and other message formats
- ✅ **Message Management**
  - Reply messages
  - Push messages
- ✅ **User Management**
  - Get user profile
  - Get group member profile
  - Get room member profile
- ✅ **Group Management**
  - Get group information
  - Get group member list
  - Leave group
- ✅ **Room Management**
  - Get room member list
  - Leave room
- ✅ **Event Handling**
  - Message events
  - Follow/Unfollow events
  - Join/Leave group events
  - Member joined/left events
  - Postback events
- ✅ **Proxy Support**
  - HTTP/HTTPS proxy
  - Proxy authentication support

## Installation

```bash
npm install @onebots/adapter-line
# or
pnpm add @onebots/adapter-line
```

For proxy support, install the optional dependency:

```bash
npm install https-proxy-agent
```

## Configuration

Configure Line account in `config.yaml`:

```yaml
# Line bot account configuration
line.your_bot_id:
  # Line platform configuration
  channel_access_token: 'your_channel_access_token'  # Channel Access Token, required
  channel_secret: 'your_channel_secret'              # Channel Secret, required
  
  # Optional configuration
  webhook_path: '/line/your_bot_id/webhook'  # Custom webhook path
  
  # Proxy configuration (optional)
  proxy:
    url: 'http://127.0.0.1:7890'  # Proxy server address
    username: 'proxy_user'        # Proxy username (optional)
    password: 'proxy_pass'        # Proxy password (optional)
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
```

## Getting Channel Access Token and Channel Secret

1. Visit [Line Developers Console](https://developers.line.biz/console/)
2. Create a Provider (if you don't have one)
3. Create a new Messaging API Channel
4. Get the **Channel Secret** from the "Basic settings" page
5. Generate or get the **Channel Access Token** from the "Messaging API" page

## Webhook Configuration

The Line adapter uses Webhook mode to receive messages. After starting the service, configure the Webhook URL in Line Developers Console:

1. Go to your Channel in Line Developers Console
2. Find "Webhook settings" on the "Messaging API" page
3. Set the Webhook URL to:
   ```
   https://your-domain.com/line/{account_id}/webhook
   ```
   For example:
   ```
   https://bot.example.com/line/my_bot/webhook
   ```
4. Click "Verify" to verify the Webhook
5. Enable "Use webhook"

::: warning Note
- Webhook URL must be HTTPS
- Ensure your server is accessible from the public internet
- Consider using a reverse proxy (like Nginx) in production
:::

## Client SDK Usage

```typescript
import { ImHelper } from 'imhelper';
import { OneBotV11Adapter } from '@imhelper/onebot-v11';

const client = new ImHelper();

// Register OneBot V11 protocol adapter
client.registerAdapter('onebot.v11', OneBotV11Adapter);

// Connect to onebots server
await client.connect({
  platform: 'line',
  account_id: 'your_bot_id',
  protocol: 'onebot.v11',
  endpoint: 'ws://localhost:6727/line/your_bot_id/onebot/v11/ws',
  access_token: 'your_access_token',
});
```

## Supported Message Types

### Sending Messages

| Type | Description |
|------|-------------|
| text | Text message |
| image | Image message |
| video | Video message |
| audio | Audio message |
| file | File message |
| location | Location message |
| sticker | Sticker message |

### Receiving Messages

| Type | Description |
|------|-------------|
| text | Text message |
| image | Image message |
| video | Video message |
| audio | Audio message |
| file | File message |
| location | Location message |
| sticker | Sticker message |

## Related Links

- [Line Adapter Configuration](/en/config/adapter/line)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)

