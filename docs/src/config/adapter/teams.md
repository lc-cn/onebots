# Teams 适配器配置

Microsoft Teams 适配器配置说明。

## 配置字段

| 字段名 | 类型 | 描述 | 默认值 |
|--------|------|------|--------|
| `app_id` | string | Microsoft App ID（从 Azure Portal 获取） | 必填 |
| `app_password` | string | Microsoft App Password（从 Azure Portal 获取） | 必填 |
| `webhook` | object | Webhook 配置 | - |
| `webhook.url` | string | Webhook URL（可选，如果使用自定义域名） | - |
| `webhook.port` | number | Webhook 端口（可选，默认使用全局配置） | - |
| `channel_service` | string | Channel Service URL（可选，用于政府云等特殊环境） | - |
| `open_id_metadata` | string | OpenID Metadata URL（可选，用于自定义认证） | - |

## 配置示例

### 基本配置

```yaml
accounts:
  - platform: teams
    account_id: my_teams_bot
    protocol: onebot.v11
    
    app_id: "12345678-1234-1234-1234-123456789012"
    app_password: "your_app_password_here"
    webhook:
      url: https://your-domain.com/teams/my_teams_bot/webhook
      port: 8080
```

### 高级配置（政府云）

```yaml
accounts:
  - platform: teams
    account_id: my_teams_bot
    protocol: onebot.v11
    
    app_id: "12345678-1234-1234-1234-123456789012"
    app_password: "your_app_password_here"
    webhook:
      url: https://your-domain.com/teams/my_teams_bot/webhook
      port: 8080
    channel_service: https://botframework.azure.us
    open_id_metadata: https://login.microsoftonline.us/common/v2.0/.well-known/openid-configuration
```

## 获取 App ID 和 App Password

1. 登录 [Azure Portal](https://portal.azure.com)
2. 创建 "Azure Bot" 资源
3. 在资源页面中：
   - **App ID**：在 "Configuration" 页面查看
   - **App Password**：在 "Configuration" 页面生成或查看

## Webhook 配置

Teams Bot 必须使用 Webhook 模式接收消息。Webhook URL 格式：

```
https://your-domain.com/teams/{account_id}/webhook
```

其中 `{account_id}` 是配置中的 `account_id`。

### 本地开发

本地开发时，可以使用内网穿透工具（如 ngrok）：

```bash
ngrok http 8080
```

然后在 Azure Portal 中配置 Webhook URL 为：

```
https://your-ngrok-url.ngrok.io/teams/my_teams_bot/webhook
```

## 注意事项

1. **HTTPS 要求**：生产环境的 Webhook URL 必须是 HTTPS
2. **消息限制**：Teams 对消息发送频率有限制，请遵守限制
3. **自适应卡片**：Teams 支持丰富的自适应卡片格式，可以创建更丰富的交互体验

## 相关链接

- [Microsoft Bot Framework 文档](https://dev.botframework.com/)
- [Teams Bot 开发文档](https://docs.microsoft.com/en-us/microsoftteams/platform/bots/what-are-bots)

