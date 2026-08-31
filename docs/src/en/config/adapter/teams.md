# Teams Adapter Configuration

Microsoft Teams adapter configuration guide.

## Configuration Fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `app_id` | string | Microsoft App ID (get from Azure Portal) | Required |
| `app_password` | string | Microsoft App Password (get from Azure Portal) | Required |
| `webhook` | object | Webhook configuration | - |
| `webhook.url` | string | Webhook URL (optional, if using custom domain) | - |
| `webhook.port` | number | Webhook port (optional, uses global config by default) | - |
| `channel_service` | string | Channel Service URL (optional, for government cloud, etc.) | - |
| `open_id_metadata` | string | OpenID Metadata URL (optional, for custom authentication) | - |

## Configuration Example

### Basic Configuration

```yaml
teams.my_teams_bot:
  app_id: "12345678-1234-1234-1234-123456789012"
  app_password: "your_app_password_here"
  webhook:
    url: https://your-domain.com/teams/my_teams_bot/webhook
    port: 8080
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
```

### Advanced Configuration (Government Cloud)

```yaml
teams.my_teams_bot:
  app_id: "12345678-1234-1234-1234-123456789012"
  app_password: "your_app_password_here"
  webhook:
    url: https://your-domain.com/teams/my_teams_bot/webhook
    port: 8080
  channel_service: https://botframework.azure.us
  open_id_metadata: https://login.microsoftonline.us/common/v2.0/.well-known/openid-configuration
```

## Related Links

- [Microsoft Teams Platform](/en/platform/teams)
- [Quick Start](/en/guide/start)

