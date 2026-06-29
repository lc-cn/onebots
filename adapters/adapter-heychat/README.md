# @onebots/adapter-heychat

onebots 黑盒语音 (Heychat) 适配器

## 简介

用于 onebots 框架的黑盒语音官方机器人适配器。黑盒语音是面向游戏玩家的语音+文字社区平台，概念类似 Discord / KOOK。

## 功能特性

- WebSocket 长连接与心跳保活
- 斜杠命令事件（type=50）
- 普通频道消息（type=5，实验性，需联调确认）
- 频道消息发送与删除
- 房间信息查询

## 安装

```bash
npm install @onebots/adapter-heychat
# 或
pnpm add @onebots/adapter-heychat
```

## 前置条件

1. 在 [黑盒语音开发者平台](https://open.xiaoheihe.cn/zh_cn/chat_robot/home) 完成开发者认证
2. 在 [机器人控制台](https://bot.xiaoheihe.cn) 创建机器人并获取 Token
3. 在控制台配置斜杠命令，并将机器人邀请进目标房间

## 配置

```yaml
heychat.my_bot:
  token: 'your_bot_token'
  chat_version: '1.30.0'  # 可选
  onebot.v11:
    access_token: 'your_v11_token'
```

### 配置项说明

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| account_id | string | 是 | 账号标识（配置键后缀） |
| token | string | 是 | 机器人 Token |
| api_base | string | 否 | REST API 地址，默认 `https://chat.xiaoheihe.cn` |
| ws_url | string | 否 | WebSocket 地址 |
| chat_version | string | 否 | 客户端版本，默认 `1.30.0` |
| ping_interval | number | 否 | 心跳间隔（秒），默认 30 |
| ignore_self_messages | boolean | 否 | 忽略自身消息，默认 true |

## 启动

```bash
onebots -r heychat -p onebot-v11 -c config.yaml
```

## 发送消息说明

黑盒语音发送频道消息需要同时提供 `room_id` 与 `channel_id`：

- 收到消息后，适配器会自动缓存 `channel_id → room_id` 映射
- 也可使用 `room_id:channel_id` 作为 `scene_id`

## 限制

- 无 Webhook 模式，需常驻进程维持 WebSocket
- 官方文档以斜杠命令为主；普通消息 (type=5) 为实验性支持
- Bot 必须先被邀请进房间才能收发消息

## 文档

- [黑盒语音机器人帮助文档](https://s.apifox.cn/43256fe4-9a8c-4f22-949a-74a3f8b431f5)
- [官方 Demo](https://github.com/QingFengOpen/HeychatDemo)

## License

MIT
