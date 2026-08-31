# Feishu / Lark Adapter Configuration

Feishu adapter configuration guide. Supports both Feishu (China) and Lark (International).

## Configuration Fields

### app_id

- **Type**: `string`
- **Required**: ✅
- **Description**: Feishu/Lark App ID

### app_secret

- **Type**: `string`
- **Required**: ✅
- **Description**: Feishu/Lark App Secret

### encrypt_key

- **Type**: `string`
- **Required**: ❌
- **Description**: Event encryption key (required when encryption mode is enabled)

### verification_token

- **Type**: `string`
- **Required**: ❌
- **Description**: Event verification Token

### endpoint

- **Type**: `string`
- **Required**: ❌
- **Default**: `https://open.feishu.cn/open-apis`
- **Description**: API endpoint URL for switching between Feishu/Lark or private deployment

| Endpoint | URL | Description |
|----------|-----|-------------|
| Feishu (default) | `https://open.feishu.cn/open-apis` | China |
| Lark | `https://open.larksuite.com/open-apis` | International |

## Configuration Examples

### Feishu (China)

```yaml
feishu.my_bot:
  app_id: 'cli_xxxxxxxxxxxxx'
  app_secret: 'your_app_secret'
  encrypt_key: 'your_encrypt_key'  # Optional
  verification_token: 'your_verification_token'  # Optional
  # endpoint can be omitted, defaults to Feishu China
```

### Lark (International)

```yaml
feishu.lark_bot:
  app_id: 'cli_xxxxxxxxxxxxx'
  app_secret: 'your_app_secret'
  endpoint: 'https://open.larksuite.com/open-apis'  # Lark endpoint
```

### TypeScript Configuration

```typescript
import { FeishuEndpoint } from '@onebots/adapter-feishu';

// Lark (International)
{
  account_id: 'lark_bot',
  app_id: 'cli_xxx',
  app_secret: 'xxx',
  endpoint: FeishuEndpoint.LARK,
}
```

## Getting App Credentials

### Feishu (China)

1. Visit [Feishu Open Platform](https://open.feishu.cn/)
2. Create an enterprise self-built app
3. Get `App ID` and `App Secret` from "App Information"
4. Configure Webhook URL in "Event Subscription": `http://your-server:port/feishu/{account_id}/webhook`
5. Get `Encrypt Key` and `Verification Token` (if encryption is enabled)
6. Configure app permissions (message sending/receiving, contacts, etc.)

### Lark (International)

1. Visit [Lark Developer](https://open.larksuite.com/)
2. Create an application and get credentials
3. Configuration is the same as Feishu

## Related Links

- [Feishu Platform](/en/platform/feishu)
- [Quick Start](/en/guide/start)

