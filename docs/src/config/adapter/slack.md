# Slack 适配器配置

Slack 适配器配置说明。

## 配置项

### token

- **类型**: `string`
- **必填**: ✅
- **说明**: Slack Bot Token（格式：`xoxb-...`）

### signing_secret

- **类型**: `string`
- **必填**: HTTP Events API 模式下必填
- **说明**: Signing Secret（用于验证 Events API 请求；Web 表单仅在该模式显示）

### app_token

- **类型**: `string`
- **必填**: Socket Mode 下必填
- **说明**: App-Level Token（格式：`xapp-...`；Web 表单仅在该模式显示）

### receive_mode

- **类型**: `socket | webhook`
- **默认值**: `socket`
- **说明**: 事件接收方式；这是唯一模式来源，不再使用 `socket_mode` 布尔字段

## 配置示例

### 基础配置（Events API）

```yaml
slack.my_bot:
  token: 'xoxb-your-bot-token'
  receive_mode: webhook
  signing_secret: 'your_signing_secret'
```

### Socket Mode 配置

```yaml
slack.my_bot:
  token: 'xoxb-your-bot-token'
  receive_mode: socket
  app_token: 'xapp-your-app-token'
```

## 获取应用凭证

1. 访问 [Slack API](https://api.slack.com/)
2. 创建应用（Create New App）
3. 在 "OAuth & Permissions" 中配置权限：
   - `chat:write` - 发送消息
   - `channels:read` - 读取频道信息
   - `channels:history` - 读取频道历史
   - `users:read` - 读取用户信息
   - `im:read` - 读取私聊
   - `im:write` - 发送私聊消息
4. 安装应用到工作区
5. 获取 Bot User OAuth Token（`xoxb-...`）
6. 在 "Event Subscriptions" 中配置 HTTPS Webhook URL：`https://your-server/slack/{account_id}/webhook`
7. 获取 Signing Secret（用于验证请求）

## Webhook 地址

配置事件订阅 URL 为：

```
https://your-domain/slack/{account_id}/webhook
```

例如：
```
https://bot.example.com/slack/my_bot/webhook
```

## 相关链接

- [适配器配置指南](/guide/adapter)
- [Slack 平台文档](/platform/slack)
