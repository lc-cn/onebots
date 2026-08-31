# Telegram 适配器配置

Telegram 适配器配置说明。

## 配置项

### token

- **类型**: `string`
- **必填**: ✅
- **说明**: Telegram Bot Token，从 [@BotFather](https://t.me/BotFather) 获取

### polling

轮询模式配置（默认模式）。

#### polling.enabled

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否启用轮询模式

#### polling.timeout

- **类型**: `number`
- **默认值**: `30`
- **单位**: 秒
- **说明**: 轮询超时时间

#### polling.limit

- **类型**: `number`
- **默认值**: `100`
- **说明**: 每次获取的更新数量

#### polling.allowed_updates

- **类型**: `string[]`
- **必填**: ❌
- **说明**: 允许的更新类型，如 `['message', 'callback_query']`

### webhook

Webhook 模式配置。

#### webhook.url

- **类型**: `string`
- **必填**: ❌（Webhook 模式必填）
- **说明**: Webhook URL，Telegram 服务器会推送事件到此地址

#### webhook.secret_token

- **类型**: `string`
- **必填**: ❌
- **说明**: Webhook 密钥，用于验证请求来源

#### webhook.allowed_updates

- **类型**: `string[]`
- **必填**: ❌
- **说明**: 允许的更新类型

## 代理配置

如果你在中国大陆等需要代理的地区，需要配置代理才能连接 Telegram API：

### proxy

代理配置对象。

#### proxy.url

- **类型**: `string`
- **必填**: ❌
- **说明**: 代理服务器地址，支持 `http://` 和 `https://`

#### proxy.username

- **类型**: `string`
- **必填**: ❌
- **说明**: 代理用户名（如需要）

#### proxy.password

- **类型**: `string`
- **必填**: ❌
- **说明**: 代理密码（如需要）

### 可选依赖

使用代理功能需要安装额外的依赖：

```bash
npm install https-proxy-agent
```

## 配置示例

### 轮询模式（推荐）

```yaml
telegram.my_bot:
  token: 'your_telegram_bot_token'
  polling:
    enabled: true
    timeout: 30
    limit: 100
    allowed_updates:
      - message
      - callback_query
```

### 使用代理

```yaml
telegram.my_bot:
  token: 'your_telegram_bot_token'
  proxy:
    url: "http://127.0.0.1:7890"  # 你的代理地址
    # username: "user"  # 可选
    # password: "pass"  # 可选
```

### Webhook 模式

```yaml
telegram.my_bot:
  token: 'your_telegram_bot_token'
  webhook:
    url: 'https://your-domain.com/webhook'
    secret_token: 'your_secret_token'
    allowed_updates:
      - message
      - callback_query
```

## 获取 Bot Token

1. 在 Telegram 中搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建新机器人
3. 按照提示设置机器人名称和用户名
4. 获取 Bot Token（格式：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz-YourTokenHere`）

## Webhook 地址

如果使用 Webhook 模式，需要在 Telegram 中配置 Webhook URL：

```
https://your-domain.com/telegram/{account_id}/webhook
```

例如：
```
https://bot.example.com/telegram/my_bot/webhook
```

## 相关链接

- [适配器配置指南](/guide/adapter)
- [Telegram 平台文档](/platform/telegram)

