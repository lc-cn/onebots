# WeChat Adapter Configuration

WeChat Official Account adapter configuration guide.

## Configuration Format

```yaml
wechat.{account_id}:
  # WeChat platform configuration
  app_id: 'your_app_id'           # Required: Official Account AppID
  app_secret: 'your_app_secret'   # Required: Official Account AppSecret
  token: 'your_token'              # Required: Server configuration Token
  encoding_aes_key: 'your_key'    # Optional: Message encryption/decryption key
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
  onebot.v12:
    access_token: 'your_v12_token'
```

## Configuration Fields

| Field | Type | Required | Description | Default |
|-------|------|----------|-------------|---------|
| `app_id` | string | Yes | Official Account AppID | - |
| `app_secret` | string | Yes | Official Account AppSecret | - |
| `token` | string | Yes | Server configuration Token | - |
| `encoding_aes_key` | string | No | Message encryption/decryption key (required for safe mode) | - |

## Getting Configuration Information

1. Log in to [WeChat Public Platform](https://mp.weixin.qq.com/)
2. In "Development" - "Basic Configuration", get:
   - **AppID**
   - **AppSecret** (requires admin permission)
3. In "Development" - "Basic Configuration" - "Server Configuration", set:
   - **URL**: `http://your-domain:6727/wechat/{account_id}/webhook`
   - **Token**: Custom token (must match configuration file)
   - **EncodingAESKey**: Randomly generated or custom (required for safe mode)

## Related Links

- [WeChat Platform](/en/platform/wechat)
- [Quick Start](/en/guide/start)

