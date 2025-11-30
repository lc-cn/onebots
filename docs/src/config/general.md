# 通用配置 (general)

通用配置（general）用于设置各协议的默认参数，这些配置会被所有账号继承，除非在账号级别进行覆盖。

## 配置位置

在 `config.yaml` 的 `general` 字段中配置：

```yaml
general:
  # OneBot V11 协议默认配置
  onebot.v11:
    use_http: true
    use_ws: false
    
  # OneBot V12 协议默认配置
  onebot.v12:
    use_http: true
    use_ws: false
    
  # Satori 协议默认配置
  satori.v1:
    path: /satori
    
  # Milky 协议默认配置
  milky.v1:
    use_http: true
    use_ws: false
```

## OneBot V11 配置

### use_http

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否启用 HTTP API 接口

### use_ws

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 是否启用正向 WebSocket

### use_ws_reverse

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 是否启用反向 WebSocket

### ws_reverse_url

- **类型**: `string`
- **默认值**: 无
- **说明**: 反向 WebSocket 连接地址
- **示例**: `ws://localhost:8080/ws`

### ws_reverse_api_url

- **类型**: `string`
- **默认值**: 无
- **说明**: 反向 WebSocket API 连接地址（可选，用于分离 API 和事件）

### ws_reverse_event_url

- **类型**: `string`
- **默认值**: 无
- **说明**: 反向 WebSocket 事件连接地址（可选）

### access_token

- **类型**: `string`
- **默认值**: 无
- **说明**: API 访问令牌，用于鉴权

### secret

- **类型**: `string`
- **默认值**: 无
- **说明**: 上报签名密钥

### post_timeout

- **类型**: `number`
- **默认值**: `5000`
- **单位**: 毫秒
- **说明**: HTTP POST 请求超时时间

### post_message_format

- **类型**: `string`
- **可选值**: `string` | `array`
- **默认值**: `string`
- **说明**: 消息格式，`string` 为 CQ 码字符串，`array` 为消息段数组

### enable_heartbeat

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否启用心跳

### heartbeat_interval

- **类型**: `number`
- **默认值**: `15000`
- **单位**: 毫秒
- **说明**: 心跳间隔

## OneBot V12 配置

### use_http

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否启用 HTTP API 接口

### use_ws

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 是否启用正向 WebSocket

### use_ws_reverse

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 是否启用反向 WebSocket

### ws_reverse_url

- **类型**: `string`
- **默认值**: 无
- **说明**: 反向 WebSocket 连接地址

### access_token

- **类型**: `string`
- **默认值**: 无
- **说明**: API 访问令牌

### heartbeat_interval

- **类型**: `number`
- **默认值**: `15000`
- **单位**: 毫秒
- **说明**: 心跳间隔

## Satori 配置

### path

- **类型**: `string`
- **默认值**: `/satori`
- **说明**: WebSocket 连接路径

### token

- **类型**: `string`
- **默认值**: 无
- **说明**: 鉴权令牌

### heartbeat_interval

- **类型**: `number`
- **默认值**: `10000`
- **单位**: 毫秒
- **说明**: 心跳间隔

### version

- **类型**: `string`
- **默认值**: `v1`
- **说明**: Satori 协议版本

## Milky 配置

### use_http

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否启用 HTTP API 接口

### use_ws

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 是否启用 WebSocket

### timeout

- **类型**: `number`
- **默认值**: `5000`
- **单位**: 毫秒
- **说明**: 请求超时时间

## 配置示例

### 最小配置

只启用必要功能：

```yaml
general:
  onebot.v11:
    use_http: true
```

### 完整配置

启用所有功能：

```yaml
general:
  onebot.v11:
    use_http: true
    use_ws: true
    use_ws_reverse: true
    ws_reverse_url: ws://localhost:8080/ws
    access_token: your_secret_token
    enable_heartbeat: true
    heartbeat_interval: 15000
    post_message_format: array
    
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: your_secret_token
    
  satori.v1:
    path: /satori
    token: your_satori_token
    heartbeat_interval: 10000
    
  milky.v1:
    use_http: true
    use_ws: true
```

### 多协议配置

同时启用多个协议：

```yaml
general:
  # 为不同框架提供不同协议
  onebot.v11:
    use_http: true      # 给 NoneBot2 使用
    
  satori.v1:
    path: /satori       # 给 Koishi 使用
    
  milky.v1:
    use_http: true      # 给自定义框架使用
```

## 配置继承

账号配置会继承并覆盖通用配置：

```yaml
general:
  onebot.v11:
    use_http: true
    use_ws: false       # 默认不启用 WebSocket

wechat.account1:
  onebot.v11:
    use_ws: true        # 这个账号启用 WebSocket，其他配置继承 general
    
wechat.account2:
  # 这个账号完全继承 general 配置
```

## 相关链接

- [全局配置](/config/global)
- [平台配置](/config/platform)
- [协议配置](/config/protocol)
- [OneBot V11 协议](/protocol/onebot-v11)
- [Satori 协议](/protocol/satori)
