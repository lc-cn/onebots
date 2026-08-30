# Feishu / Lark Adapter

The Feishu adapter is fully implemented and supports connecting to onebots service through Feishu/Lark Open Platform Bot API. It supports both **Feishu (China)** and **Lark (International)**.

## Status

✅ **Implemented and Available**

## Features

- ✅ **Messaging and interactions**: direct/group messages, replies, message/thread forwarding, rich posts, cards, media, contact cards, reactions, follow-up bubbles, urgent notifications, and pins
- ✅ **Message management**: fetch, recall, card updates, read users, and batch-message status management
- ✅ **Chat management**: chat details, members, managers, share links, and announcements
- ✅ **Directories**: bot identity, visible contact users, and verified chat members
- ✅ **Event ingress**: official long connection, webhook, and manual host integration; unknown events remain available through `raw_event`
- ✅ **Reliability**: shared tenant-token refresh, event deduplication, guarded cursor pagination, and structured platform errors
- ✅ **Multi-Endpoint Support**
  - Feishu (China)
  - Lark (International)
  - Custom endpoint (private deployment)

## Installation

```bash
npm install @onebots/adapter-feishu
# or
pnpm add @onebots/adapter-feishu
```

## Configuration

Configure Feishu/Lark account in `config.yaml`:

```yaml
# Feishu bot account configuration (China, default)
feishu.feishu_bot:
  app_id: 'your_app_id'  # App ID, required
  app_secret: 'your_app_secret'  # App Secret, required
  receive_mode: long_connection  # long_connection | webhook | manual
  encrypt_key: 'your_encrypt_key'  # Optional, event encryption key
  verification_token: 'your_verification_token'  # Optional, event verification Token
  
  # OneBot V11 protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'

# Lark bot account configuration (International)
feishu.lark_bot:
  app_id: 'your_app_id'
  app_secret: 'your_app_secret'
  endpoint: 'https://open.larksuite.com/open-apis'  # Lark endpoint
  
  # OneBot V11 protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `app_id` | string | Yes | Feishu/Lark App ID |
| `app_secret` | string | Yes | Feishu/Lark App Secret |
| `receive_mode` | string | No | Event ingress mode; defaults to `long_connection` |
| `encrypt_key` | string | No | Event encryption key |
| `verification_token` | string | No | Event verification Token |
| `endpoint` | string | No | API endpoint, defaults to Feishu China |

### Endpoint Configuration

| Endpoint | URL | Description |
|----------|-----|-------------|
| Feishu (default) | `https://open.feishu.cn/open-apis` | China |
| Lark | `https://open.larksuite.com/open-apis` | International |

### TypeScript Configuration

When using TypeScript, you can import endpoint constants:

```typescript
import { FeishuEndpoint } from '@onebots/adapter-feishu';

// Feishu (China) - endpoint can be omitted
{
  account_id: 'feishu_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
}

// Lark (International)
{
  account_id: 'lark_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
  endpoint: FeishuEndpoint.LARK,
}

// Private deployment
{
  account_id: 'private_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
  endpoint: 'https://your-private-feishu.com/open-apis',
}
```

## Getting App Credentials

### Feishu (China)

1. Visit [Feishu Open Platform](https://open.feishu.cn/)
2. Create an enterprise self-built application
3. Get `App ID` and `App Secret`
4. Select the official long connection, or configure the Webhook URL: `http://your-server:port/feishu/{account_id}/webhook`
5. Configure application permissions (messaging, contacts, etc.)

### Lark (International)

1. Visit [Lark Developer](https://open.larksuite.com/)
2. Create an application and get credentials
3. Configuration is the same as Feishu, just set `endpoint` to Lark endpoint

## Client SDK Usage

```typescript
import { createOnebot12Client } from '@imhelper/onebot-v12';

const client = createOnebot12Client({
  baseUrl: 'http://localhost:6727/feishu/your_bot_id/onebot/v12',
  apiBaseUrl: 'http://localhost:6727/feishu/your_bot_id/onebot/v12',
  wsUrl: 'ws://localhost:6727/feishu/your_bot_id/onebot/v12',
  selfId: 'your_bot_id',
  accessToken: 'your_access_token',
  receiveMode: 'ws',
});

client.on('message.group', async message => {
  await message.reply('Received!');
});

await client.start();
```

## Related Links

- [Feishu Open Platform](https://open.feishu.cn/)
- [Lark Developer](https://open.larksuite.com/)
- [Feishu Adapter Configuration](/en/config/adapter/feishu)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)
