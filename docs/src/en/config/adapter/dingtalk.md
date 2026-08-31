# DingTalk Adapter Configuration

DingTalk adapter configuration guide.

## Configuration Modes

DingTalk adapter supports two modes:

1. **Enterprise Internal App Mode**: Authenticated via AppKey/AppSecret, supports complete message and event capabilities
2. **Custom Bot Mode**: Via Webhook URL, only supports group chat message push

The two modes cannot be used simultaneously, automatically selected based on configuration.

## Enterprise Internal App Mode

### Configuration Fields

#### app_key

- **Type**: `string`
- **Required**: ✅ (Required for enterprise internal app mode)
- **Description**: DingTalk App AppKey

#### app_secret

- **Type**: `string`
- **Required**: ✅ (Required for enterprise internal app mode)
- **Description**: DingTalk App AppSecret

#### agent_id

- **Type**: `string`
- **Required**: ❌
- **Description**: Enterprise internal app AgentId

#### encrypt_key

- **Type**: `string`
- **Required**: ❌
- **Description**: Event encryption key

#### token

- **Type**: `string`
- **Required**: ❌
- **Description**: Event verification Token

### Configuration Example

```yaml
dingtalk.my_app:
  # Enterprise internal app mode
  app_key: 'your_app_key'
  app_secret: 'your_app_secret'
  agent_id: 'your_agent_id'
  encrypt_key: 'your_encrypt_key'
  token: 'your_token'
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
```

## Custom Bot Mode

### Configuration Fields

#### webhook_url

- **Type**: `string`
- **Required**: ✅ (Required for custom bot mode)
- **Description**: Custom bot webhook URL

### Configuration Example

```yaml
dingtalk.my_bot:
  # Custom bot mode
  webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=xxx'
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
```

## Related Links

- [DingTalk Platform](/en/platform/dingtalk)
- [Quick Start](/en/guide/start)

