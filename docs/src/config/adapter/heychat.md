# 黑盒语音适配器配置

黑盒语音 (Heychat) 适配器配置说明。

## 配置格式

```yaml
heychat.{account_id}:
  token: 'your_bot_token'
  api_base: 'https://chat.xiaoheihe.cn'
  ws_url: 'wss://chat.xiaoheihe.cn/chatroom/ws/connect'
  chat_version: '1.30.0'
  ping_interval: 30
  ignore_self_messages: true

  onebot.v11:
    access_token: 'your_v11_token'
  onebot.v12:
    access_token: 'your_v12_token'
  satori.v1:
    token: 'your_satori_token'
    platform: 'heychat'
  milky.v1:
    access_token: 'your_milky_token'
```

## 配置项说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `token` | string | 是 | 机器人 Token，从 [bot.xiaoheihe.cn](https://bot.xiaoheihe.cn) 获取 |
| `api_base` | string | 否 | REST API 基址，默认 `https://chat.xiaoheihe.cn` |
| `upload_base` | string | 否 | 媒体上传 API，默认 `https://chat-upload.xiaoheihe.cn` |
| `ws_url` | string | 否 | WebSocket 网关地址 |
| `chat_version` | string | 否 | 客户端版本号，默认 `1.30.0` |
| `ping_interval` | number | 否 | 心跳间隔（秒），默认 30 |
| `ignore_self_messages` | boolean | 否 | 是否忽略机器人自身消息，默认 true |

## 获取 Token

1. 访问 [黑盒语音开发者平台](https://open.xiaoheihe.cn/zh_cn/chat_robot/home) 完成认证
2. 访问 [机器人控制台](https://bot.xiaoheihe.cn) 创建机器人
3. 在机器人详情页复制 Token

## 完整配置示例

```yaml
port: 6727
log_level: info

heychat.game_bot:
  token: 'your_bot_token'
  chat_version: '1.30.0'

  onebot.v11:
    use_http: true
    use_ws: true
    access_token: 'v11_secret'
    ws_reverse: []
```

## 注意事项

- 需在控制台预先注册斜杠命令，Bot 才能收到 type=50 事件
- 发送消息时若只有 channel_id，需先收到该频道的事件以建立 room 映射
- 也可使用 `room_id:channel_id` 作为 scene_id 主动发送

## 相关文档

- [黑盒语音平台指南](/platform/heychat)
- [官方 API 文档](https://s.apifox.cn/43256fe4-9a8c-4f22-949a-74a3f8b431f5)
