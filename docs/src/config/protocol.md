# 协议配置

协议配置用于设置 OneBots 对外提供的协议接口参数。可以在 general 中设置默认值，也可以在账号级别单独配置。

## 配置层级

```yaml
# 1. 全局默认（general）
general:
  {protocol}.{version}:
    param: value

# 2. 账号级别（覆盖 general）
{platform}.{account_id}:
  {protocol}.{version}:
    param: value
```

## 支持的协议

- `onebot.v11` - OneBot V11 协议
- `onebot.v12` - OneBot V12 协议
- `satori.v1` - Satori 协议
- `milky.v1` - Milky 协议

## OneBot V11

### 通信方式配置

```yaml
onebot.v11:
  use_http: true              # HTTP API
  use_ws: false               # 正向 WebSocket
  use_ws_reverse: false       # 反向 WebSocket
```

### HTTP API

启用后，提供 HTTP POST 接口调用 API。

**访问地址**: `http://localhost:6727/{platform}/{account_id}/onebot/v11/{action}`

**配置项**:
```yaml
onebot.v11:
  use_http: true
  access_token: your_token    # 可选，API 鉴权
  post_timeout: 5000          # 请求超时（毫秒）
```

### 正向 WebSocket

客户端主动连接到 OneBots。

**访问地址**: `ws://localhost:6727/{platform}/{account_id}/onebot/v11`

**配置项**:
```yaml
onebot.v11:
  use_ws: true
  access_token: your_token    # 可选，连接鉴权
```

### 反向 WebSocket

OneBots 主动连接到指定服务器。

**配置项**:
```yaml
onebot.v11:
  use_ws_reverse: true
  ws_reverse_url: ws://localhost:8080/ws           # 连接地址
  ws_reverse_api_url: ws://localhost:8080/api      # API 专用地址（可选）
  ws_reverse_event_url: ws://localhost:8080/event  # 事件专用地址（可选）
  access_token: your_token                         # 可选，鉴权
  ws_reverse_reconnect_interval: 3000              # 重连间隔（毫秒）
```

### 其他配置

```yaml
onebot.v11:
  post_message_format: string   # 消息格式: string(CQ码) | array(消息段数组)
  enable_heartbeat: true        # 是否启用心跳
  heartbeat_interval: 15000     # 心跳间隔（毫秒）
  secret: your_secret           # 上报签名密钥
```

## OneBot V12

### 通信方式配置

```yaml
onebot.v12:
  use_http: true              # HTTP API
  use_ws: false               # 正向 WebSocket
  use_ws_reverse: false       # 反向 WebSocket
```

### HTTP API

**访问地址**: `http://localhost:6727/{platform}/{account_id}/onebot/v12/{action}`

**配置项**:
```yaml
onebot.v12:
  use_http: true
  access_token: your_token
```

### WebSocket

**正向地址**: `ws://localhost:6727/{platform}/{account_id}/onebot/v12`

**配置项**:
```yaml
onebot.v12:
  use_ws: true
  access_token: your_token
```

### 反向 WebSocket

**配置项**:
```yaml
onebot.v12:
  use_ws_reverse: true
  ws_reverse_url: ws://localhost:8080/ws
  access_token: your_token
```

### 其他配置

```yaml
onebot.v12:
  heartbeat_interval: 15000   # 心跳间隔（毫秒）
```

## Satori

Satori 协议基于 WebSocket 通信。

### 基础配置

```yaml
satori.v1:
  path: /satori               # WebSocket 路径
  token: your_token           # 鉴权令牌（可选）
```

**访问地址**: `ws://localhost:6727/{platform}/{account_id}/satori`

### 完整配置

```yaml
satori.v1:
  path: /satori
  token: your_satori_token
  heartbeat_interval: 10000   # 心跳间隔（毫秒）
  version: v1                 # 协议版本
```

### 连接示例

```javascript
const ws = new WebSocket('ws://localhost:6727/wechat/my_mp/satori');

ws.on('open', () => {
  // 发送认证
  ws.send(JSON.stringify({
    op: 3, // IDENTIFY
    body: { token: 'your_token' }
  }));
});
```

## Milky

轻量级协议，支持 HTTP 和 WebSocket。

### 基础配置

```yaml
milky.v1:
  use_http: true
  use_ws: false
```

### HTTP API

**访问地址**: `http://localhost:6727/{platform}/{account_id}/milky/v1/{action}`

**配置项**:
```yaml
milky.v1:
  use_http: true
  timeout: 5000               # 请求超时（毫秒）
```

### WebSocket

**访问地址**: `ws://localhost:6727/{platform}/{account_id}/milky/v1`

**配置项**:
```yaml
milky.v1:
  use_ws: true
```

## 多协议配置

一个账号可以同时提供多个协议接口：

```yaml
wechat.my_account:
  appid: wx123
  appsecret: secret
  token: token
  
  # 同时启用 3 个协议
  onebot.v11:
    use_http: true
    use_ws: true
    
  satori.v1:
    path: /satori
    token: satori_token
    
  milky.v1:
    use_http: true
```

访问地址：
- OneBot V11 HTTP: `http://localhost:6727/wechat/my_account/onebot/v11/...`
- OneBot V11 WS: `ws://localhost:6727/wechat/my_account/onebot/v11`
- Satori: `ws://localhost:6727/wechat/my_account/satori`
- Milky: `http://localhost:6727/wechat/my_account/milky/v1/...`

## 协议选择指南

### OneBot V11

**适合场景**:
- 使用 NoneBot2、Koishi 等支持 OneBot V11 的框架
- 需要与现有 OneBot 生态兼容
- 熟悉 CQ 码格式

**推荐配置**:
```yaml
onebot.v11:
  use_http: true              # HTTP 调用 API
  use_ws: false               # WebSocket 接收事件
  post_message_format: array  # 使用消息段数组（更规范）
```

### OneBot V12

**适合场景**:
- 需要更现代的协议设计
- 跨平台机器人应用
- 需要更好的类型系统

**推荐配置**:
```yaml
onebot.v12:
  use_http: true
  use_ws: true
```

### Satori

**适合场景**:
- 使用 Koishi 框架
- 需要真正的跨平台支持
- 追求现代化的协议设计

**推荐配置**:
```yaml
satori.v1:
  path: /satori
  token: your_secure_token
```

### Milky

**适合场景**:
- 自定义轻量级机器人
- 性能敏感应用
- 简单的消息收发需求

**推荐配置**:
```yaml
milky.v1:
  use_http: true
  use_ws: true
```

## 完整配置示例

```yaml
# 全局配置
port: 6727
log_level: info

# 协议默认配置
general:
  onebot.v11:
    use_http: true
    enable_heartbeat: true
    heartbeat_interval: 15000
    
  satori.v1:
    path: /satori
    heartbeat_interval: 10000

# 微信账号 - 为 Koishi 提供服务
wechat.for_koishi:
  appid: wx111
  appsecret: secret1
  token: token1
  
  # Koishi 推荐使用 Satori
  satori.v1:
    token: koishi_token

# 微信账号 - 为 NoneBot2 提供服务  
wechat.for_nonebot:
  appid: wx222
  appsecret: secret2
  token: token2
  
  # NoneBot2 使用 OneBot V11
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: nonebot_token

# 微信账号 - 多框架同时使用
wechat.multi_framework:
  appid: wx333
  appsecret: secret3
  token: token3
  
  # 同时提供多个协议
  onebot.v11:
    use_http: true
    
  onebot.v12:
    use_http: true
    
  satori.v1:
    path: /satori
    
  milky.v1:
    use_http: true
```

## 相关链接

- [全局配置](/config/global)
- [通用配置](/config/general)
- [平台配置](/config/platform)
- [OneBot V11 协议](/protocol/onebot-v11)
- [OneBot V12 协议](/protocol/onebot-v12)
- [Satori 协议](/protocol/satori)
- [Milky 协议](/protocol/milky)
