# 黑盒语音适配器配置

黑盒语音（Heychat）适配器默认建立官方正向 WebSocket，接收命令、回应、成员变化与卡片交互。嵌入式 Host 也可以选择 `manual`，把已有连接中的事件交给同一投影和去重链路。

## 最小配置

```yaml
heychat.game_bot:
  token: 'your_bot_token'
  receive_mode: websocket

  onebot.v11:
    access_token: 'your_v11_token'
```

`receive_mode` 可选：

| 值 | 行为 |
|----|------|
| `websocket` | 默认值。OneBots 建立正向 WebSocket，并在断线后无限指数退避重连 |
| `manual` | 不创建网络连接；宿主调用 `HeychatBot.ingest()` 或 `acceptWebSocket()` |

## 配置字段

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `account_id` | string | OneBots 内部账号标识 | 必填 |
| `token` | string | 机器人控制台签发的 Bot Token | 必填 |
| `receive_mode` | `websocket` \| `manual` | 事件接收方式 | `websocket` |
| `api_base_url` | string | REST API 根地址 | `https://chat.xiaoheihe.cn` |
| `upload_base_url` | string | 媒体上传 API 根地址 | `https://chat-upload.xiaoheihe.cn` |
| `ws_url` | string | 正向 WebSocket 地址 | 官方地址 |
| `chat_version` | string | 随官方请求发送的客户端版本 | `1.30.0` |
| `voice_api_type` | `trtc` \| `volc` | 创建语音频道时使用的线路 | `trtc` |
| `heartbeat_interval_ms` | number | 心跳间隔，最低 5000 毫秒 | `30000` |
| `reconnect_initial_delay_ms` | number | 首次重连延迟，最低 100 毫秒 | `1000` |
| `reconnect_max_delay_ms` | number | 最大重连延迟，不能小于首次延迟 | `30000` |
| `request_timeout_ms` | number | REST 请求与 WebSocket 握手超时 | `30000` |
| `proxy.url` | string | HTTP(S) 与 WebSocket 共用的 HTTP/SOCKS 代理 | - |
| `proxy.username` | string | 代理用户名 | - |
| `proxy.password` | string | 代理密码 | - |

旧字段 `api_base`、`upload_base`、`ping_interval` 和 `ignore_self_messages` 不属于当前配置契约；请使用表中字段，管理端 Schema 也会生成相同结构。

## 连接与重试

```yaml
heychat.game_bot:
  token: 'your_bot_token'
  receive_mode: websocket
  ws_url: 'wss://chat.xiaoheihe.cn/chatroom/ws/connect'
  chat_version: '1.30.0'
  heartbeat_interval_ms: 30000
  reconnect_initial_delay_ms: 1000
  reconnect_max_delay_ms: 30000
  request_timeout_ms: 30000
```

连接采用带抖动的无限指数退避。连续一个心跳周期未收到 pong 时会重建连接。事件在本地按序交付；业务出口失败时会有界退避重试，账号停止后立即取消队列等待。

## 启动超时与取消

正向 WebSocket 握手与后续协议出口共用 OneBots 全局 `timeout`。超时、人工停止或配置热重载取消启动时，适配器会终止待握手 socket、清除重连与心跳定时器，并让待完成的连接 Promise 明确结束；连接代次会阻止迟到回调恢复账号状态。Bot 就绪后仍保留账号信号，协议启动失败时可完整回滚连接。

## 手动接入

```yaml
heychat.embedded:
  token: 'your_bot_token'
  receive_mode: manual
```

`manual` 不打开 WebSocket。宿主可以传入已解析事件，也可以通过 `acceptWebSocket()` 接入已经升级的 socket；适配器只监听业务帧，不接管宿主的心跳、关闭和重连。

## 用户 OAuth

读取用户资料或语音时长等扩展动作需要独立 OAuth 凭据；普通机器人动作不需要启用：

```yaml
heychat.game_bot:
  token: 'your_bot_token'
  oauth:
    enabled: true
    client_id: 'oauth_client_id'
    client_secret: 'oauth_client_secret'
    redirect_uri: 'https://your-domain.example/oauth/heychat'
```

## 获取 Token

1. 在[黑盒语音开发者平台](https://open.xiaoheihe.cn/zh_cn/chat_robot/home)完成认证。
2. 在[机器人控制台](https://bot.xiaoheihe.cn)创建机器人并复制 Token。
3. 预先注册斜杠命令，Bot 才能收到对应的 `type=50` 事件。

发送频道消息时可直接使用 `room_id:channel_id` 作为 `scene_id`。如果只提供 `channel_id`，适配器必须先收到该频道事件以建立精确的房间映射，不会猜测目标。

## 相关文档

- [黑盒语音平台指南](/platform/heychat)
- [官方 API 文档](https://s.apifox.cn/43256fe4-9a8c-4f22-949a-74a3f8b431f5)
