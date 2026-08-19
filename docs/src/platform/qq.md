# QQ 适配器

QQ 适配器通过 QQ 官方 API 接入 onebots。自 v4 起，内部实现迁移为对 [`qq-official-bot`](https://www.npmjs.com/package/qq-official-bot) 的薄包装。

## 状态

✅ **已实现并可用**

## 功能支持

- ✅ QQ 频道消息（公域 / 私域）
- ✅ QQ 群消息
- ✅ 单聊消息（C2C）
- ✅ 频道私信（DMS）
- ✅ 频道管理
- ✅ 成员管理
- ✅ 消息表态
- ✅ 互动按钮
- ✅ WebSocket 与 Webhook 双模式

## 安装

```bash
npm install @onebots/adapter-qq
# 或
pnpm add @onebots/adapter-qq
```

## v4 迁移提示

- `appId` 已改为 `appid`
- `token` / `maxRetry` / `logLevel` 已删除
- Webhook 模式改为 SDK 自己启动 HTTP 服务，必须显式配置 `port`
- 旧 Intent 名会自动映射到 SDK 新名，但建议尽快改掉

## 配置示例

### WebSocket 模式

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  mode: 'websocket'
  sandbox: false
  intents:
    - 'GROUP_AND_C2C_EVENT'
    - 'DIRECT_MESSAGE'
    - 'GUILDS'
    - 'GUILD_MEMBERS'
    - 'GUILD_MESSAGE_REACTIONS'
    - 'INTERACTION'
    - 'PUBLIC_GUILD_MESSAGES'
    - 'FORUMS_EVENT'

  onebot.v11:
    use_http: true
    use_ws: true
    access_token: 'your_token'
```

### Webhook 模式

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  mode: 'webhook'
  port: 18080
  path: '/qq/webhook'
```

> v4 起 Webhook 不再复用 OneBots 主路由，QQ 开放平台回调地址应填写 `http://your-server:18080/qq/webhook`。

## 支持的 Intent

推荐使用 SDK 新名：

| Intent | 说明 |
|--------|------|
| `GUILDS` | 频道变更事件 |
| `GUILD_MEMBERS` | 频道成员变更事件 |
| `GUILD_MESSAGES` | 私域机器人频道消息事件 |
| `PUBLIC_GUILD_MESSAGES` | 公域机器人频道消息事件 |
| `GUILD_MESSAGE_REACTIONS` | 频道消息表态事件 |
| `DIRECT_MESSAGE` | 频道私信事件 |
| `GROUP_AND_C2C_EVENT` | 群聊 @ 消息与私聊消息事件 |
| `MESSAGE_AUDIT` | 消息审核事件 |
| `INTERACTION` | 互动事件 |
| `FORUMS_EVENT` | 论坛事件 |
| `AUDIO_ACTION` | 音频操作事件 |

兼容旧名：

| 旧值 | 新值 |
|------|------|
| `GROUP_AT_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT` |
| `C2C_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT` |
| `OPEN_FORUMS_EVENT` | `FORUMS_EVENT` |

## 相关文档

- [QQ 适配器配置](/config/adapter/qq)
- [客户端 SDK 使用指南](/guide/client-sdk)
- [QQ 开放平台](https://q.qq.com/)
- [QQ 机器人文档](https://bot.q.qq.com/wiki/)
