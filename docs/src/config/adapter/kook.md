# Kook 适配器配置

Kook（原开黑啦）适配器配置说明。

## 配置格式

```yaml
kook.{account_id}:
  # Kook 平台配置
  token: 'your_kook_token'        # 必填：Kook 机器人 Token
  mode: 'websocket'                # 可选：连接模式，'websocket'（默认）或 'webhook'
  verifyToken: 'your_verify_token' # 可选：Webhook 验证 Token（Webhook 模式需要）
  encryptKey: 'your_encrypt_key'   # 可选：消息加密密钥
  
  # 协议配置
  onebot.v11:
    access_token: 'your_v11_token'
  onebot.v12:
    access_token: 'your_v12_token'
  satori.v1:
    token: 'your_satori_token'
    platform: 'kook'
  milky.v1:
    access_token: 'your_milky_token'
```

## 配置项说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `token` | string | 是 | Kook 机器人 Token，从 [KOOK 开发者平台](https://developer.kookapp.cn/) 获取 |
| `mode` | string | 否 | 连接模式：<br>- `websocket`（默认）：使用 WebSocket 连接，实时接收事件<br>- `webhook`：使用 Webhook 模式，需要配置回调地址 |
| `verifyToken` | string | 否 | Webhook 验证 Token，Webhook 模式必填 |
| `encryptKey` | string | 否 | 消息加密密钥，可选 |

## 连接模式

### WebSocket 模式（推荐）

WebSocket 模式是默认模式，提供实时双向通信：

```yaml
kook.zhin:
  token: 'your_kook_token'
  mode: 'websocket'  # 可省略，默认值
```

**优点**：
- 实时接收事件
- 低延迟
- 双向通信

### Webhook 模式

Webhook 模式需要配置回调地址，适合服务器部署场景：

```yaml
kook.zhin:
  token: 'your_kook_token'
  mode: 'webhook'
  verifyToken: 'your_verify_token'
```

**配置步骤**：
1. 在 KOOK 开发者平台配置 Webhook 回调地址
2. 设置 `verifyToken` 与平台配置一致
3. 如果启用了消息加密，需要设置 `encryptKey`

## 获取 Token

1. 访问 [KOOK 开发者平台](https://developer.kookapp.cn/)
2. 登录并创建应用
3. 在应用中添加机器人
4. 在机器人设置中获取 Token

## 完整配置示例

```yaml
port: 6727
log_level: info
timeout: 30

general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  satori.v1:
    use_http: true
    use_ws: true
    token: ''
  milky.v1:
    use_http: true
    use_ws: true
    access_token: ''

# Kook 机器人账号配置
kook.my_bot:
  # Kook 平台配置
  token: 'your_kook_token'
  mode: 'websocket'
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'kook_v11_token'
  
  # OneBot V12 协议配置
  onebot.v12:
    access_token: 'kook_v12_token'
  
  # Satori V1 协议配置
  satori.v1:
    token: 'kook_satori_token'
    platform: 'kook'
  
  # Milky V1 协议配置
  milky.v1:
    access_token: 'kook_milky_token'
```

## 相关文档

- [Kook 平台说明](/platform/kook)
- [适配器配置指南](/guide/adapter)
- [客户端SDK使用指南](/guide/client-sdk)

