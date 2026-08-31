# Milky V1 协议配置

Milky V1 协议的完整配置项说明。

## 配置位置

可以在 `general` 中设置默认值，也可以在账号级别单独配置：

```yaml
# 全局默认配置
general:
  milky.v1:
    use_http: true
    use_ws: false

# 账号级别配置（覆盖 general）
{platform}.{account_id}:
  milky.v1:
    use_http: true
    use_ws: true
```

## 配置项说明

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `use_http` | `boolean` \| `HttpConfig` | 否 | 是否启用 HTTP API 或 HTTP 配置对象 | `true` |
| `use_ws` | `boolean` \| `WsConfig` | 否 | 是否启用 WebSocket 或 WebSocket 配置对象 | `false` |
| `access_token` | `string` | 否 | 访问令牌，用于鉴权 | - |
| `secret` | `string` | 否 | HMAC 签名密钥 | - |
| `heartbeat` | `number` | 否 | 心跳间隔（秒） | - |
| `post_message_format` | `string` | 否 | 消息格式：`string` 或 `array` | `string` |
| `http_reverse` | `string[]` \| `HttpReverseConfig[]` | 否 | HTTP 反向推送配置列表 | `[]` |
| `ws_reverse` | `string[]` \| `WsReverseConfig[]` | 否 | WebSocket 反向连接配置列表 | `[]` |
| `filters` | `any` | 否 | 事件过滤器 | - |

### HttpConfig 对象

当 `use_http` 为对象时，支持以下配置：

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `enabled` | `boolean` | 否 | 是否启用 | `true` |
| `host` | `string` | 否 | 监听地址 | - |
| `port` | `number` | 否 | 监听端口 | - |
| `access_token` | `string` | 否 | 访问令牌（覆盖全局） | - |
| `secret` | `string` | 否 | 签名密钥（覆盖全局） | - |
| `timeout` | `number` | 否 | 请求超时时间（毫秒） | `5000` |

### WsConfig 对象

当 `use_ws` 为对象时，支持以下配置：

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `enabled` | `boolean` | 否 | 是否启用 | `true` |
| `host` | `string` | 否 | 监听地址 | - |
| `port` | `number` | 否 | 监听端口 | - |
| `access_token` | `string` | 否 | 访问令牌（覆盖全局） | - |
| `secret` | `string` | 否 | 签名密钥（覆盖全局） | - |

### HttpReverseConfig 对象

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `url` | `string` | 是 | 推送地址 | - |
| `access_token` | `string` | 否 | 访问令牌（覆盖全局） | - |
| `secret` | `string` | 否 | 签名密钥（覆盖全局） | - |
| `timeout` | `number` | 否 | 超时时间（毫秒） | `5000` |

### WsReverseConfig 对象

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `url` | `string` | 是 | 连接地址 | - |
| `access_token` | `string` | 否 | 访问令牌（覆盖全局） | - |
| `secret` | `string` | 否 | 签名密钥（覆盖全局） | - |

## 通信方式

### HTTP API

启用 HTTP API 后，提供 HTTP POST 接口调用 API。

**访问地址**: `http://localhost:6727/{platform}/{account_id}/milky/v1/{action}`

**配置示例**:
```yaml
milky.v1:
  use_http: true
  access_token: 'your_token'
  # 或使用详细配置
  use_http:
    enabled: true
    access_token: 'your_token'
    timeout: 5000
```

### 正向 WebSocket

客户端主动连接到 onebots，实时接收事件。

**访问地址**: `ws://localhost:6727/{platform}/{account_id}/milky/v1`

**配置示例**:
```yaml
milky.v1:
  use_ws: true
  access_token: 'your_token'
  # 或使用详细配置
  use_ws:
    enabled: true
    access_token: 'your_token'
```

### HTTP Reverse (Webhook)

配置 HTTP Reverse 后，事件会推送到指定地址。

**配置示例**:
```yaml
milky.v1:
  http_reverse:
    - url: 'http://localhost:5702/milky'
      timeout: 5000
      access_token: 'webhook_token'
    - 'http://localhost:5703/milky'  # 简单字符串格式
```

### WebSocket Reverse

配置 WebSocket Reverse 后，onebots 会主动连接到指定服务器。

**配置示例**:
```yaml
milky.v1:
  ws_reverse:
    - url: 'ws://localhost:6702/milky'
      access_token: 'ws_token'
    - 'ws://localhost:6703/milky'  # 简单字符串格式
```

## 完整配置示例

### 基础配置

```yaml
general:
  milky.v1:
    use_http: true
    use_ws: false
    access_token: 'default_token'
```

### 完整配置

```yaml
general:
  milky.v1:
    use_http:
      enabled: true
      timeout: 5000
      access_token: 'http_token'
    use_ws:
      enabled: true
      access_token: 'ws_token'
    access_token: 'global_token'
    secret: 'hmac_secret'
    heartbeat: 15
    post_message_format: 'array'
    http_reverse:
      - url: 'http://localhost:5702/milky'
        timeout: 5000
    ws_reverse:
      - url: 'ws://localhost:6702/milky'
```

### 账号级别配置

```yaml
kook.zhin:
  token: 'kook_token'
  
  milky.v1:
    use_http: true
    use_ws: true
    access_token: 'milky_token'
    post_message_format: 'array'
```

## 消息格式

### string 格式

使用字符串格式（类似 CQ 码）：

```yaml
milky.v1:
  post_message_format: 'string'
```

### array 格式

使用消息段数组格式：

```yaml
milky.v1:
  post_message_format: 'array'
```

## 相关链接

- [协议配置](/config/protocol)
- [Milky 协议文档](/protocol/milky)
- [客户端SDK使用指南](/guide/client-sdk)

