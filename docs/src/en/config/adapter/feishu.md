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

### receive_mode

- **Type**: `long_connection | webhook | manual`
- **Required**: ❌
- **Default**: `long_connection`
- **Description**: `long_connection` uses the official persistent connection; `webhook` mounts a callback on the OneBots HTTP server; `manual` accepts events from an existing host or queue through `ingest()`

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
  receive_mode: 'long_connection'  # Optional; this is the default
  encrypt_key: 'your_encrypt_key'  # Optional
  verification_token: 'your_verification_token'  # Optional
  # endpoint can be omitted, defaults to Feishu China
```

### Lark (International)

```yaml
feishu.lark_bot:
  app_id: 'cli_xxxxxxxxxxxxx'
  app_secret: 'your_app_secret'
  receive_mode: 'long_connection'
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
4. The default persistent-connection mode does not require a request URL; select persistent connection and add the required events
5. Configure a request URL, `Encrypt Key`, and `Verification Token` only when using `webhook`
6. Configure app permissions (message sending/receiving, contacts, etc.)

### Lark (International)

1. Visit [Lark Developer](https://open.larksuite.com/)
2. Create an application and get credentials
3. Configuration is the same as Feishu

## Webhook URL

Only for `receive_mode: webhook`, configure the event-subscription URL as `https://your-domain/feishu/{account_id}/webhook` and forward that path to OneBots without changing the request body.

## Startup Timeout and Cancellation

Feishu account startup obtains a tenant token, verifies the bot identity, and opens the official persistent connection under the global OneBots `timeout`. A timeout or configuration-reload cancellation aborts token and identity requests, force-closes a connection whose startup has not completed, and prevents late responses from restoring online state. The signal remains active after identity and connection readiness until protocol outlets finish, allowing a failed outlet startup to roll back the complete account lifecycle.

## Related Links

- [Feishu Platform](/en/platform/feishu)
- [Quick Start](/en/guide/start)
