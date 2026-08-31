# Feishu / Lark Adapter

The Feishu adapter is fully implemented and supports connecting to onebots service through Feishu/Lark Open Platform Bot API. It supports both **Feishu (China)** and **Lark (International)**.

## Status

✅ **Implemented and Available**

## Features

- ✅ **Message Sending/Receiving**
  - Private chat message sending/receiving
  - Group chat message sending/receiving
  - Supports text, rich text, cards, and other message formats
- ✅ **Message Management**
  - Message editing
  - Message deletion
- ✅ **Group Management**
  - Get group information
  - Get group member list and information
  - Leave group
  - Kick members
- ✅ **User Management**
  - Get user information
- ✅ **Event Subscription**
  - Webhook event subscription
  - Automatic token management (app access token and tenant access token)
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
4. Configure event subscription URL (Webhook): `http://your-server:port/feishu/{account_id}/webhook`
5. Configure application permissions (messaging, contacts, etc.)

### Lark (International)

1. Visit [Lark Developer](https://open.larksuite.com/)
2. Create an application and get credentials
3. Configuration is the same as Feishu, just set `endpoint` to Lark endpoint

## Client SDK Usage

```typescript
import { ImHelper } from 'imhelper';
import { OneBotV11Adapter } from '@imhelper/onebot-v11';

const client = new ImHelper();

// Register OneBot V11 protocol adapter
client.registerAdapter('onebot.v11', OneBotV11Adapter);

// Connect to onebots server
await client.connect({
  platform: 'feishu',
  account_id: 'your_bot_id',
  protocol: 'onebot.v11',
  endpoint: 'ws://localhost:6727/feishu/your_bot_id/onebot/v11/ws',
  access_token: 'your_access_token',
});
```

## Related Links

- [Feishu Open Platform](https://open.feishu.cn/)
- [Lark Developer](https://open.larksuite.com/)
- [Feishu Adapter Configuration](/en/config/adapter/feishu)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)

