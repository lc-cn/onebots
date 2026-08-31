# Satori V1 协议配置

Satori V1 协议的完整配置项说明。

## 配置位置

可以在 `general` 中设置默认值，也可以在账号级别单独配置：

```yaml
# 全局默认配置
general:
  satori.v1:
    use_ws: true
    path: /satori

# 账号级别配置（覆盖 general）
{platform}.{account_id}:
  satori.v1:
    use_ws: true
    path: /satori
    token: 'your_token'
```

## 配置项说明

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `use_http` | `boolean` \| `HttpConfig` | 否 | 是否启用 HTTP API 或 HTTP 配置对象 | `false` |
| `use_ws` | `boolean` \| `WsConfig` | 否 | 是否启用 WebSocket 或 WebSocket 配置对象 | `true` |
| `token` | `string` | 否 | 访问令牌，用于鉴权 | - |
| `self_id` | `string` | 否 | 机器人 ID | - |
| `platform` | `string` | 否 | 平台名称 | `satori` |
| `webhooks` | `string[]` \| `WebhookConfig[]` | 否 | Webhook 配置列表 | `[]` |
| `filters` | `any` | 否 | 事件过滤器 | - |

### HttpConfig 对象

当 `use_http` 为对象时，支持以下配置：

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `enabled` | `boolean` | 否 | 是否启用 | `true` |
| `host` | `string` | 否 | 监听地址 | - |
| `port` | `number` | 否 | 监听端口 | - |
| `token` | `string` | 否 | 访问令牌（覆盖全局） | - |
| `path` | `string` | 否 | 路径前缀 | - |

### WsConfig 对象

当 `use_ws` 为对象时，支持以下配置：

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `enabled` | `boolean` | 否 | 是否启用 | `true` |
| `host` | `string` | 否 | 监听地址 | - |
| `port` | `number` | 否 | 监听端口 | - |
| `token` | `string` | 否 | 访问令牌（覆盖全局） | - |
| `path` | `string` | 否 | WebSocket 路径 | `/satori` |

### WebhookConfig 对象

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `url` | `string` | 是 | Webhook 地址 | - |
| `token` | `string` | 否 | 访问令牌（覆盖全局） | - |

## 通信方式

### HTTP API

启用 HTTP API 后，提供 HTTP POST 接口调用 API。

**访问地址**: `http://localhost:6727/{platform}/{account_id}/satori/v1/{endpoint}`

**配置示例**:
```yaml
satori.v1:
  use_http: true
  # 或使用详细配置
  use_http:
    enabled: true
    path: /satori
    token: 'your_token'
```

### WebSocket

客户端主动连接到 onebots，实时接收事件。

**访问地址**: `ws://localhost:6727/{platform}/{account_id}/satori`

**配置示例**:
```yaml
satori.v1:
  use_ws: true
  path: /satori
  token: 'your_token'
  # 或使用详细配置
  use_ws:
    enabled: true
    path: /satori
    token: 'your_token'
```

**连接示例**:
```javascript
const ws = new WebSocket('ws://localhost:6727/kook/zhin/satori');

ws.on('open', () => {
  // 发送认证
  ws.send(JSON.stringify({
    op: 3, // IDENTIFY
    body: {
      token: 'your_token'
    }
  }));
});
```

### Webhook

配置 Webhook 后，事件会推送到指定地址。

**配置示例**:
```yaml
satori.v1:
  webhooks:
    - url: 'http://localhost:8080/webhook'
      token: 'webhook_token'
    - 'http://localhost:8081/webhook'  # 简单字符串格式
```

## 完整配置示例

### 基础配置

```yaml
general:
  satori.v1:
    use_ws: true
    path: /satori
    token: 'default_token'
```

### 完整配置

```yaml
general:
  satori.v1:
    use_http:
      enabled: true
      path: /satori
      token: 'http_token'
    use_ws:
      enabled: true
      path: /satori
      token: 'ws_token'
    token: 'global_token'
    platform: 'kook'
    webhooks:
      - url: 'http://localhost:8080/webhook'
        token: 'webhook_token'
```

### 账号级别配置

```yaml
kook.zhin:
  token: 'kook_token'
  
  satori.v1:
    use_ws: true
    path: /satori
    token: 'satori_token'
    platform: 'kook'
```

## 相关链接

- [协议配置](/config/protocol)
- [Satori 协议文档](/protocol/satori)
- [客户端SDK使用指南](/guide/client-sdk)

