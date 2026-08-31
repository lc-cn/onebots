# 钉钉适配器配置

钉钉适配器配置说明。

## 配置模式

钉钉适配器支持两种模式：

1. **企业内部应用模式**：通过 AppKey/AppSecret 认证，支持完整的消息和事件能力
2. **自定义机器人模式**：通过 Webhook URL，仅支持群聊消息推送

两种模式不能同时使用，根据配置自动选择。

## 企业内部应用模式

### 配置项

#### app_key

- **类型**: `string`
- **必填**: ✅（企业内部应用模式必填）
- **说明**: 钉钉应用 AppKey

#### app_secret

- **类型**: `string`
- **必填**: ✅（企业内部应用模式必填）
- **说明**: 钉钉应用 AppSecret

#### agent_id

- **类型**: `string`
- **必填**: ❌
- **说明**: 企业内部应用的 AgentId

#### encrypt_key

- **类型**: `string`
- **必填**: ❌
- **说明**: 事件加密密钥

#### token

- **类型**: `string`
- **必填**: ❌
- **说明**: 事件验证 Token

### 配置示例

```yaml
dingtalk.my_bot:
  app_key: 'your_app_key'
  app_secret: 'your_app_secret'
  agent_id: 'your_agent_id'  # 可选
  encrypt_key: 'your_encrypt_key'  # 可选
  token: 'your_token'  # 可选
```

### 获取应用凭证

1. 访问 [钉钉开放平台](https://open.dingtalk.com/)
2. 创建企业内部应用
3. 在"应用信息"中获取 `AppKey` 和 `AppSecret`
4. 在"应用详情"中获取 `AgentId`（可选）
5. 在"事件订阅"中配置 Webhook URL：`http://your-server:port/dingtalk/{account_id}/webhook`
6. 获取 `Encrypt Key` 和 `Token`（如果启用加密）
7. 配置应用权限（消息收发、通讯录等）

## 自定义机器人模式

### 配置项

#### webhook_url

- **类型**: `string`
- **必填**: ✅（自定义机器人模式必填）
- **说明**: 自定义机器人 Webhook URL

### 配置示例

```yaml
dingtalk.my_bot:
  webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN'
```

### 获取 Webhook URL

1. 在钉钉群聊中，点击"群设置" -> "智能群助手" -> "添加机器人"
2. 选择"自定义"机器人
3. 设置机器人名称和头像
4. 获取 Webhook URL

## Webhook 地址

如果使用企业内部应用模式，配置事件订阅 URL 为：

```
http://your-domain:port/dingtalk/{account_id}/webhook
```

例如：
```
http://bot.example.com:6727/dingtalk/my_bot/webhook
```

## 相关链接

- [适配器配置指南](/guide/adapter)
- [钉钉平台文档](/platform/dingtalk)
