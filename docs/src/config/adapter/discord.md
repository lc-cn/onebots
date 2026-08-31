# Discord 适配器配置

Discord 适配器配置说明。

## 配置格式

```yaml
discord.{account_id}:
  # Discord 平台配置
  token: 'your_discord_bot_token'  # 必填：Discord Bot Token
  intents:  # 可选：Gateway Intents
    - Guilds
    - GuildMessages
    - GuildMembers
    - GuildMessageReactions
    - DirectMessages
    - DirectMessageReactions
    - MessageContent
  partials:  # 可选：Partials
    - Message
    - Channel
    - Reaction
  presence:  # 可选：机器人状态
    status: online  # online, idle, dnd, invisible
    activities:
      - name: '正在运行 onebots'
        type: 0  # 0: Playing, 1: Streaming, 2: Listening, 3: Watching, 5: Competing
  
  # 协议配置
  onebot.v11:
    access_token: 'your_v11_token'
  onebot.v12:
    access_token: 'your_v12_token'
```

## 配置项说明

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `token` | string | 是 | Discord Bot Token | - |
| `intents` | string[] | 否 | Gateway Intents，需要接收的事件类型 | `[]` |
| `partials` | string[] | 否 | Partials，部分数据支持 | `[]` |
| `presence` | object | 否 | 机器人状态和活动 | - |
| `proxy` | object | 否 | 代理配置 | - |
| `proxy.url` | string | 否 | 代理服务器地址 | - |
| `proxy.username` | string | 否 | 代理用户名 | - |
| `proxy.password` | string | 否 | 代理密码 | - |

## 代理配置

如果你在中国大陆等需要代理的地区，需要配置代理才能连接 Discord：

```yaml
discord.my_bot:
  token: 'your_token'
  proxy:
    url: "http://127.0.0.1:7890"  # 你的代理地址
    # username: "user"  # 可选
    # password: "pass"  # 可选
```

### 可选依赖

使用代理功能需要安装额外的依赖：

```bash
# 推荐同时安装（WebSocket 使用 SOCKS5 更稳定）
npm install https-proxy-agent socks-proxy-agent
```

| 依赖 | 用途 |
|------|------|
| `https-proxy-agent` | REST API 代理 |
| `socks-proxy-agent` | WebSocket 代理（推荐） |

::: tip 提示
适配器会自动将 HTTP 代理转换为 SOCKS5 用于 WebSocket 连接，因为 SOCKS5 对长连接支持更好。确保你的代理软件（如 Clash）开启了混合端口。
:::

## 必需的 Intents

根据你的机器人功能，可能需要启用以下 Privileged Intents：

- **PRESENCE INTENT** - 如果需要在状态中显示成员信息
- **SERVER MEMBERS INTENT** - 如果需要获取服务器成员列表
- **MESSAGE CONTENT INTENT** - 如果需要读取消息内容（必需）

## 获取 Token

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 点击 "New Application" 创建新应用
3. 进入应用后，点击左侧 "Bot" 菜单
4. 点击 "Reset Token" 获取 Bot Token
5. 在 "Privileged Gateway Intents" 中启用需要的 Intents

## 完整配置示例

```yaml
port: 6727
log_level: info
timeout: 30

general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000

# Discord 机器人账号配置
discord.your_bot_id:
  # Discord 平台配置
  token: 'your_discord_bot_token'
  intents:
    - Guilds
    - GuildMessages
    - GuildMembers
    - GuildMessageReactions
    - DirectMessages
    - DirectMessageReactions
    - MessageContent
  partials:
    - Message
    - Channel
    - Reaction
  presence:
    status: online
    activities:
      - name: '正在运行 onebots'
        type: 0
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'discord_v11_token'
  
  # OneBot V12 协议配置
  onebot.v12:
    access_token: 'discord_v12_token'
```

## 相关文档

- [Discord 平台说明](/platform/discord)
- [适配器配置指南](/guide/adapter)
- [客户端SDK使用指南](/guide/client-sdk)

