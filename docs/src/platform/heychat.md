# 黑盒语音适配器

黑盒语音 (Heychat) 适配器基于官方 Bot API，支持 WebSocket 事件接收与 HTTP 消息发送。

## 状态

✅ **Beta — 已实现核心能力**

## 功能特性

- ✅ WebSocket 长连接与心跳
- ✅ 斜杠命令事件 (type=50)
- ⚠️ 普通频道消息 (type=5，实验性)
- ✅ 频道消息发送与删除
- ✅ 房间信息查询

## 安装

```bash
npm install @onebots/adapter-heychat
# 或
pnpm add @onebots/adapter-heychat
```

## 前置条件

1. 在 [开发者平台](https://open.xiaoheihe.cn/zh_cn/chat_robot/home) 完成开发者认证（约 3 个工作日）
2. 在 [bot.xiaoheihe.cn](https://bot.xiaoheihe.cn) 创建机器人并复制 Token
3. 在控制台注册斜杠命令（如 `/ping`）
4. 将机器人邀请进测试房间

## 配置

```yaml
heychat.my_bot:
  token: 'your_bot_token'
  chat_version: '1.30.0'

  onebot.v11:
    access_token: 'your_v11_token'
```

## 启动

```bash
onebots -r heychat -p onebot-v11 -c config.yaml
```

## 事件说明

| WS type | 说明 | OneBots 映射 |
|---------|------|-------------|
| 50 | 用户使用斜杠命令 | `message` (group) |
| 5 | 普通频道消息（实验性） | `message` (group) |
| 5003 | 消息表情回应 | 暂未映射 |
| 3001 | 用户加入/离开房间 | 暂未映射 |

## 发送消息

黑盒 API 要求同时提供 `room_id` 与 `channel_id`：

- 适配器在收到消息后自动缓存频道上下文
- 主动发送时可使用 `room_id:channel_id` 格式的 scene_id

## 限制

- 需常驻进程（无 Webhook 模式）
- 官方以斜杠命令为主；type=5 需实际联调验证
- Bot 必须在目标房间内

## 相关链接

- [配置说明](/config/adapter/heychat)
- [官方 API 文档](https://s.apifox.cn/43256fe4-9a8c-4f22-949a-74a3f8b431f5)
- [官方 Demo](https://github.com/QingFengOpen/HeychatDemo)
