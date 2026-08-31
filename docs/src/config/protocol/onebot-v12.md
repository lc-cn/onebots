# OneBot V12 协议配置

OneBot V12 协议的完整配置项说明。

## 配置位置

可以在 `general` 中设置默认值，也可以在账号级别单独配置：

```yaml
# 全局默认配置
general:
  onebot.v12:
    use_http: true
    use_ws: false

# 账号级别配置（覆盖 general）
{platform}.{account_id}:
  onebot.v12:
    use_http: true
    use_ws: true
```

## 配置项说明

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `use_http` | `boolean` | 否 | 是否启用 HTTP API | `true` |
| `use_ws` | `boolean` | 否 | 是否启用正向 WebSocket | `false` |
| `use_ws_reverse` | `boolean` | 否 | 是否启用反向 WebSocket | `false` |
| `access_token` | `string` | 否 | API 访问令牌，用于鉴权 | - |
| `request_timeout` | `number` | 否 | HTTP 请求超时时间（毫秒） | `15000` |
| `enable_cors` | `boolean` | 否 | 是否允许跨域 | `true` |
| `heartbeat_interval` | `number` | 否 | 心跳间隔（毫秒） | `15000` |
| `ws_reverse_url` | `string` | 否 | 反向 WebSocket 连接地址 | - |
| `ws_reverse_reconnect_interval` | `number` | 否 | 反向 WebSocket 重连间隔（毫秒） | `3000` |
| `webhook` | `string[]` | 否 | HTTP Webhook 上报地址列表 | `[]` |
| `ws_reverse` | `string[]` | 否 | 反向 WebSocket 连接地址列表 | `[]` |

## 通信方式

### HTTP API

启用 HTTP API 后，提供 HTTP POST 接口调用 API。

**访问地址**: `http://localhost:6727/{platform}/{account_id}/onebot/v12/{action}`

**配置示例**:
```yaml
onebot.v12:
  use_http: true
  access_token: 'your_token'  # 可选，API 鉴权
  request_timeout: 15000      # 请求超时（毫秒）
```

### 正向 WebSocket

客户端主动连接到 onebots，实时接收事件。

**访问地址**: `ws://localhost:6727/{platform}/{account_id}/onebot/v12`

**配置示例**:
```yaml
onebot.v12:
  use_ws: true
  access_token: 'your_token'  # 可选，连接鉴权
```

### 反向 WebSocket

onebots 主动连接到指定服务器。

**配置示例**:
```yaml
onebot.v12:
  use_ws_reverse: true
  ws_reverse_url: 'ws://localhost:8080/ws'
  access_token: 'your_token'  # 可选，鉴权
```

## 完整配置示例

```yaml
general:
  onebot.v12:
    use_http: true
    use_ws: false
    use_ws_reverse: false
    access_token: 'default_token'
    heartbeat_interval: 15000
    request_timeout: 15000
    enable_cors: true
```

## 相关链接

- [协议配置](/config/protocol)
- [通用配置](/config/general)
- [OneBot V12 协议文档](/protocol/onebot-v12)
