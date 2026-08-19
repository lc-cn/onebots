# @onebots/adapter-qq

QQ 官方机器人适配器，v4 起改为对 [`qq-official-bot`](https://www.npmjs.com/package/qq-official-bot) 的薄包装。

## 特性

- 支持 QQ 频道消息（私域 / 公域）
- 支持 QQ 群消息
- 支持 C2C 私聊
- 支持频道私信
- 支持频道 / 成员 / 表态 / 互动等主要事件
- 支持 `websocket` 与 `webhook` 两种接收模式

## 安装

```bash
npm install @onebots/adapter-qq
# 或
pnpm add @onebots/adapter-qq
```

## v4 重要变更

- 配置字段从 `appId` 改为 `appid`
- 删除 `token` / `maxRetry` / `logLevel`
- Webhook 模式不再挂载在 OneBots 主 HTTP 路由上，而是由 SDK 自行启动独立 HTTP 服务
- 旧 Intent 名 `GROUP_AT_MESSAGE_CREATE` / `C2C_MESSAGE_CREATE` / `OPEN_FORUMS_EVENT` 已弃用，会自动映射并打印警告

## 配置示例

### WebSocket 模式（默认）

```yaml
qq.my_bot:
  # QQ 平台配置
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

  # OneBot V11 协议配置
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: 'your_token'
    heartbeat_interval: 5
```

### Webhook 模式

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  mode: 'webhook'
  port: 18080
  path: '/qq/webhook'
  sandbox: false
```

Webhook 模式下，QQ 开放平台回调地址应配置为：

`http://your-server:18080/qq/webhook`

注意：`port` 是 SDK 独立监听端口，不能再复用 OneBots 主端口的 `/qq/{account_id}/webhook` 路由。

## 支持的 Intent

推荐直接使用 SDK 新名：

| Intent | 说明 |
|--------|------|
| `GUILDS` | 频道变更事件 |
| `GUILD_MEMBERS` | 频道成员变更事件 |
| `GUILD_MESSAGES` | 私域机器人频道消息事件 |
| `PUBLIC_GUILD_MESSAGES` | 公域机器人频道消息事件 |
| `GUILD_MESSAGE_REACTIONS` | 频道消息表态事件 |
| `DIRECT_MESSAGE` | 频道私信事件 |
| `GROUP_AND_C2C_EVENT` | 群聊 @ 消息与 C2C 私聊事件 |
| `MESSAGE_AUDIT` | 消息审核事件 |
| `INTERACTION` | 互动事件 |
| `FORUMS_EVENT` | 论坛事件 |
| `AUDIO_ACTION` | 音频操作事件 |

旧名兼容映射：

| 旧值 | 新值 |
|------|------|
| `GROUP_AT_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT` |
| `C2C_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT` |
| `OPEN_FORUMS_EVENT` | `FORUMS_EVENT` |

## 支持的 API

### 消息相关
- `sendMessage` - 发送消息（支持群聊、私聊、频道和频道私信）
- `deleteMessage` - 撤回消息

### 用户相关
- `getLoginInfo` - 获取机器人信息

### 频道相关
- `getGuildList` - 获取频道列表
- `getGuildInfo` - 获取频道信息
- `getChannelList` - 获取子频道列表
- `getChannelInfo` - 获取子频道信息
- `createChannel` - 创建子频道
- `updateChannel` - 修改子频道
- `deleteChannel` - 删除子频道

### 成员管理
- `getGuildMemberInfo` - 获取频道成员信息
- `kickGuildMember` - 踢出频道成员（扩展方法）
- `muteGuildMember` - 禁言频道成员（扩展方法）
- `muteGuild` - 全员禁言（扩展方法）

## 相关链接

- [QQ 开放平台](https://q.qq.com/)
- [QQ 机器人文档](https://bot.q.qq.com/wiki/)
- [配置文档](../../docs/src/config/adapter/qq.md)
