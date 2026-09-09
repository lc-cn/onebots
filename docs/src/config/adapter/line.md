# Line 适配器配置

Line 适配器配置说明。

## 配置项

### channel_access_token

- **类型**: `string`
- **必填**: ✅
- **说明**: Line Channel Access Token，从 [Line Developers Console](https://developers.line.biz/console/) 获取

### channel_secret

- **类型**: `string`
- **必填**: ✅
- **说明**: Line Channel Secret，从 [Line Developers Console](https://developers.line.biz/console/) 获取

### receive_mode

- **类型**: `webhook | manual`
- **必填**: ❌
- **默认值**: `webhook`
- **说明**: `manual` 不注册接收路由，由已有 Host 或队列调用适配器的 `ingest()`

### destination

- **类型**: `string`
- **必填**: ❌
- **说明**: LINE destination user ID；配置后会拒绝投递到其他机器人的事件

## 配置示例

### 基础配置

```yaml
line.my_bot:
  channel_access_token: 'your_channel_access_token'
  channel_secret: 'your_channel_secret'
```

### 手动接入已有 Host

```yaml
line.my_bot:
  channel_access_token: 'your_channel_access_token'
  channel_secret: 'your_channel_secret'
  receive_mode: manual
  destination: 'U0123456789abcdef0123456789abcdef'
```

## 获取 Channel Access Token

1. 访问 [Line Developers Console](https://developers.line.biz/console/)
2. 创建或选择一个 Provider
3. 创建一个新的 Messaging API Channel
4. 在 Channel 的 "Messaging API" 页面，点击 "Issue" 生成 Channel Access Token

## 获取 Channel Secret

1. 访问 [Line Developers Console](https://developers.line.biz/console/)
2. 选择你的 Channel
3. 在 "Basic settings" 页面找到 Channel Secret

## Webhook 配置

启动 onebots 服务后，需要在 Line Developers Console 配置 Webhook URL：

1. 进入你的 Channel 设置
2. 在 "Messaging API" 页面找到 "Webhook settings"
3. 设置 Webhook URL：
   ```
   https://your-domain.com/line/{account_id}/webhook
   ```
4. 点击 "Verify" 验证
5. 启用 "Use webhook"

::: tip 提示
- Webhook URL 必须使用 HTTPS
- 确保服务器可从公网访问
- 本地开发可使用 ngrok 等工具
:::

## 相关链接

- [适配器配置指南](/guide/adapter)
- [Line 平台文档](/platform/line)
