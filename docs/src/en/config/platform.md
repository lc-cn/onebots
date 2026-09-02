# Platform Configuration

Platform configuration is used to set authentication information and platform-specific parameters for platform bots.

## Configuration Format

Platform configuration uses the `{platform}.{account_id}` format:

```yaml
{platform}.{account_id}:
  # Platform-specific configuration
  platform_param1: value1
  platform_param2: value2
  
  # Protocol configuration (optional, overrides general)
  {protocol}.{version}:
    protocol_param: value
```

## WeChat Platform

### Configuration Fields

#### appid

- **Type**: `string`
- **Required**: ✅
- **Description**: WeChat Official Account AppID

#### appsecret

- **Type**: `string`
- **Required**: ✅
- **Description**: WeChat Official Account AppSecret

#### token

- **Type**: `string`
- **Required**: ✅
- **Description**: Server configuration Token (must match public platform settings)

#### encoding_aes_key

- **Type**: `string`
- **Required**: ❌
- **Description**: Message encryption/decryption key (required when encryption mode is enabled)

#### encrypt_mode

- **Type**: `string`
- **Values**: `plain` | `compatible` | `safe`
- **Default**: `plain`
- **Description**: Message encryption/decryption mode
  - `plain`: Plain text mode
  - `compatible`: Compatible mode
  - `safe`: Safe mode (encrypted)

### Configuration Example

```yaml
wechat.my_official_account:
  # WeChat platform configuration
  appid: wx1234567890abcdef
  appsecret: your_app_secret_here
  token: your_token_here
  encoding_aes_key: your_aes_key_here
  encrypt_mode: safe
  
  # Protocol configuration
  onebot.v11:
    use_http: true
    use_ws: true
```

### Getting Configuration Information

1. Log in to [WeChat Public Platform](https://mp.weixin.qq.com/)
2. Development → Basic Configuration
   - Get **AppID** and **AppSecret**
   - Set **Server Configuration**

### Webhook URL

Configure server URL as:
```
http://your-domain:6727/wechat/{account_id}/webhook
```

For example:
```
http://bot.example.com:6727/wechat/my_official_account/webhook
```

## QQ Platform

✅ **Implemented**

### Configuration Fields

#### appid

- **Type**: `string`
- **Required**: ✅
- **Description**: QQ Bot AppID (renamed to `appid` in v4)

#### secret

- **Type**: `string`
- **Required**: ✅
- **Description**: QQ Bot Secret

#### receive_mode

- **Type**: `string`
- **Values**: `websocket` | `webhook`
- **Default**: `websocket`
- **Description**: Event transport; webhook reuses the OneBots HTTP host

#### intents

- **Type**: `string[]`
- **Default**: Tencent SDK safe defaults
- **Description**: Approved QQ Gateway intents

#### api_base_url

- **Type**: `string`
- **Required**: ❌
- **Description**: Compatible OpenAPI proxy or test endpoint

#### webhook_path

- **Type**: `string`
- **Default**: `/qq/{account_id}/webhook`
- **Description**: Callback path on the OneBots HTTP host
### Configuration Example

```yaml
qq.my_bot:
  # Protocol configuration
  onebot.v11:
    use_http: true
    use_ws: true
  
  # QQ platform configuration
  appid: your_app_id
  secret: your_app_secret
  receive_mode: websocket
  intents:
    - GROUP_AND_C2C_EVENT
    - PUBLIC_GUILD_MESSAGES
```

### Webhook Mode

```yaml
qq.my_bot:
  appid: your_app_id
  secret: your_app_secret
  receive_mode: webhook
  webhook_path: /qq/my_bot/webhook
```

> QQ Webhook uses the OneBots main HTTP port. Preserve the raw request body for Ed25519 verification.

## Other Platforms

For configuration details of other platforms, see:

- [QQ Platform](/en/platform/qq)
- [Kook Platform](/en/platform/kook)
- [Discord Platform](/en/platform/discord)
- [DingTalk Platform](/en/platform/dingtalk)
- [Telegram Platform](/en/platform/telegram)
- [Feishu Platform](/en/platform/feishu)
- [Slack Platform](/en/platform/slack)
- [WeCom Platform](/en/platform/wecom)
- [Microsoft Teams Platform](/en/platform/teams)
- [Matrix Platform](/en/platform/matrix)
- [Google Chat Platform](/en/platform/google-chat)
- [Facebook Messenger Platform](/en/platform/facebook-messenger)
- [Instagram Messaging Platform](/en/platform/instagram)
- [Mattermost Platform](/en/platform/mattermost)
- [Twitch Platform](/en/platform/twitch)

## Related Links

- [Global Configuration](/en/config/global)
- [General Configuration](/en/config/general)
- [Protocol Configuration](/en/config/protocol)
