# Telegram Adapter Configuration

Telegram adapter configuration guide.

## Configuration Fields

### token

- **Type**: `string`
- **Required**: ✅
- **Description**: Telegram Bot Token, get from [@BotFather](https://t.me/BotFather)

### polling

Polling mode configuration (default mode).

#### polling.enabled

- **Type**: `boolean`
- **Default**: `true`
- **Description**: Whether to enable polling mode

#### polling.timeout

- **Type**: `number`
- **Default**: `30`
- **Unit**: seconds
- **Description**: Polling timeout

#### polling.limit

- **Type**: `number`
- **Default**: `100`
- **Description**: Number of updates to fetch per request

#### polling.allowed_updates

- **Type**: `string[]`
- **Required**: ❌
- **Description**: Allowed update types, e.g., `['message', 'callback_query']`

### webhook

Webhook mode configuration.

#### webhook.url

- **Type**: `string`
- **Required**: ❌ (Required for webhook mode)
- **Description**: Webhook URL, Telegram server will push events to this address

#### webhook.port

- **Type**: `number`
- **Default**: `8080`
- **Description**: Webhook server port

## Configuration Example

```yaml
telegram.my_bot:
  # Telegram platform configuration
  token: 'your_telegram_bot_token'
  polling:
    enabled: true
    timeout: 30
    limit: 100
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
```

## Related Links

- [Telegram Platform](/en/platform/telegram)
- [Quick Start](/en/guide/start)

