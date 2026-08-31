# Line Adapter Configuration

Line adapter configuration reference.

## Configuration Options

### channel_access_token

- **Type**: `string`
- **Required**: ✅
- **Description**: Line Channel Access Token, obtained from [Line Developers Console](https://developers.line.biz/console/)

### channel_secret

- **Type**: `string`
- **Required**: ✅
- **Description**: Line Channel Secret, obtained from [Line Developers Console](https://developers.line.biz/console/)

### webhook_path

- **Type**: `string`
- **Required**: ❌
- **Default**: `/line/{account_id}/webhook`
- **Description**: Custom webhook receive path

### proxy

Proxy configuration (optional).

#### proxy.url

- **Type**: `string`
- **Required**: ❌
- **Description**: Proxy server address, supports HTTP/HTTPS proxy

#### proxy.username

- **Type**: `string`
- **Required**: ❌
- **Description**: Proxy server username (if authentication required)

#### proxy.password

- **Type**: `string`
- **Required**: ❌
- **Description**: Proxy server password (if authentication required)

## Configuration Examples

### Basic Configuration

```yaml
line.my_bot:
  channel_access_token: 'your_channel_access_token'
  channel_secret: 'your_channel_secret'
```

### Full Configuration

```yaml
line.my_bot:
  channel_access_token: 'your_channel_access_token'
  channel_secret: 'your_channel_secret'
  webhook_path: '/line/my_bot/webhook'
  proxy:
    url: 'http://127.0.0.1:7890'
    username: 'proxy_user'
    password: 'proxy_pass'
```

## Getting Channel Access Token

1. Visit [Line Developers Console](https://developers.line.biz/console/)
2. Create or select a Provider
3. Create a new Messaging API Channel
4. On the Channel's "Messaging API" page, click "Issue" to generate a Channel Access Token

## Getting Channel Secret

1. Visit [Line Developers Console](https://developers.line.biz/console/)
2. Select your Channel
3. Find the Channel Secret on the "Basic settings" page

## Webhook Configuration

After starting the onebots service, configure the Webhook URL in Line Developers Console:

1. Go to your Channel settings
2. Find "Webhook settings" on the "Messaging API" page
3. Set the Webhook URL:
   ```
   https://your-domain.com/line/{account_id}/webhook
   ```
4. Click "Verify" to verify
5. Enable "Use webhook"

::: tip
- Webhook URL must use HTTPS
- Ensure server is accessible from the public internet
- Use tools like ngrok for local development
:::

## Related Links

- [Adapter Configuration Guide](/en/guide/adapter)
- [Line Platform Documentation](/en/platform/line)

