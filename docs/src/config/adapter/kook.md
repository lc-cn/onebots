# Kook 适配器配置

Kook（原开黑啦）适配器配置说明。

## 配置格式

```yaml
kook.{account_id}:
  # Kook 平台配置
  token: 'your_kook_token'        # 必填：Kook 机器人 Token
  receive_mode: 'gateway'           # 可选：gateway（默认）、webhook 或 manual
  verify_token: 'your_verify_token' # Webhook 模式必填
  encrypt_key: 'your_encrypt_key'   # 可选：Webhook 消息加密密钥
  max_retries: 3                    # 可选：REST 限流最大重试次数，0～10
  
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
| `receive_mode` | string | 否 | 事件入口：`gateway`（默认）、`webhook` 或 `manual` |
| `verify_token` | string | 否 | Webhook 验证 Token，Webhook 模式必填 |
| `encrypt_key` | string | 否 | Webhook 消息加密密钥 |
| `api_base_url` | string | 否 | KOOK REST API HTTPS 根地址，默认使用官方地址 |
| `max_retries` | number | 否 | REST 限流后的最大自动重试次数，默认 3，范围 0～10 |

## 连接模式

### Gateway 模式（推荐）

Gateway 模式是默认模式，通过 WebSocket 实时接收事件：

```yaml
kook.zhin:
  token: 'your_kook_token'
  receive_mode: 'gateway'  # 可省略
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
  receive_mode: 'webhook'
  verify_token: 'your_verify_token'
```

**配置步骤**：
1. 在 KOOK 开发者平台配置 Webhook 回调地址
2. 设置 `verify_token` 与平台配置一致
3. 如果启用了消息加密，需要设置 `encrypt_key`

### Manual 模式

`manual` 只校验机器人身份，不建立 Gateway 或 Webhook 事件入口，适合由现有 Host 调用 SDK 的 `ingest()` / `acceptHttp()` 注入事件。

## 启动超时与取消

KOOK 账号启动会复用 OneBots 全局 `timeout`。超时或配置热重载取消启动时，适配器会中止身份与 Gateway 地址请求，关闭尚未收到 HELLO 的 WebSocket，并阻止迟到响应把账号重新标记为在线。成功连接后，启动信号会保留到协议出口完成；若协议启动失败并触发回滚，Gateway 也会随账号停止。

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
  receive_mode: 'gateway'
  
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
