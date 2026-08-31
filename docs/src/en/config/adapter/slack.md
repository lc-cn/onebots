# Slack Adapter Configuration

Slack adapter configuration guide.

## Configuration Fields

### token

- **Type**: `string`
- **Required**: ✅
- **Description**: Slack Bot Token (format: `xoxb-...`)

### signing_secret

- **Type**: `string`
- **Required**: In HTTP Events API mode
- **Description**: Signing Secret for request verification; shown only in this mode

### app_token

- **Type**: `string`
- **Required**: In Socket Mode
- **Description**: App-Level Token (format: `xapp-...`); shown only in this mode

### receive_mode

- **Type**: `socket | webhook`
- **Default**: `socket`
- **Description**: The single event transport selector; the old `socket_mode` boolean is removed

## Configuration Example

### Basic Configuration (Events API)

```yaml
slack.my_bot:
  token: 'xoxb-your-bot-token'
  receive_mode: webhook
  signing_secret: 'your_signing_secret'
```

### Socket Mode Configuration

```yaml
slack.my_bot:
  token: 'xoxb-your-bot-token'
  receive_mode: socket
  app_token: 'xapp-your-app-token'
```

## Related Links

- [Slack Platform](/en/platform/slack)
- [Quick Start](/en/guide/start)
