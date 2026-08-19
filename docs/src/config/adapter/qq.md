# QQ 适配器配置

QQ 官方机器人适配器配置说明（基于 [qq-official-bot](https://www.npmjs.com/package/qq-official-bot) SDK）。

## 配置格式

```yaml
qq.{account_id}:
  # QQ 平台配置
  appid: 'your_app_id'           # 必填：QQ机器人AppID（v4 起改为 appid，小写 d）
  secret: 'your_secret'          # 必填：QQ机器人Secret
  mode: 'websocket'              # 可选：连接模式，'websocket'（默认）或 'webhook'
  sandbox: false                 # 可选：是否沙箱环境，默认 false
  intents:                       # 可选：需要监听的事件（仅WebSocket模式需要）
    - 'GROUP_AND_C2C_EVENT'      # 群@消息 与 私聊消息（旧名 GROUP_AT_MESSAGE_CREATE / C2C_MESSAGE_CREATE 已弃用）
    - 'DIRECT_MESSAGE'           # 频道私信事件
    - 'GUILDS'                   # 频道变更事件
    - 'GUILD_MEMBERS'           # 频道成员变更事件
    - 'GUILD_MESSAGE_REACTIONS' # 频道消息表态事件
    - 'INTERACTION'              # 互动事件
    - 'PUBLIC_GUILD_MESSAGES'   # 公域机器人频道消息事件
    - 'FORUMS_EVENT'             # 论坛事件（旧名 OPEN_FORUMS_EVENT 已弃用）
  # Webhook 模式专用
  port: 18080                    # webhook 模式必填：SDK 独立监听的端口（与 OneBots 主端口区分）
  path: '/qq/webhook'            # 可选：webhook 路径，默认 '/'
  apiBaseUrl: 'https://api.bot.qq.com'  # 可选：高级，自定义 API 根地址

  # 协议配置
  onebot.v11:
    access_token: 'your_v11_token'
  onebot.v12:
    access_token: 'your_v12_token'
```

## 配置项说明

| 字段名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `appid` | string | 是 | QQ机器人AppID（v4 起改名） | - |
| `secret` | string | 是 | QQ机器人Secret | - |
| `mode` | string | 否 | 连接模式：`websocket`（默认）或 `webhook` | `websocket` |
| `sandbox` | boolean | 否 | 是否沙箱环境 | `false` |
| `intents` | string[] | 否 | 需要监听的事件（仅 WebSocket 模式需要） | `[]` |
| `apiBaseUrl` | string | 否 | 自定义 API 根地址（高级，优先级高于 `sandbox`） | - |
| `port` | number | webhook 模式必填 | SDK 独立监听的端口（与 OneBots 主端口区分） | - |
| `path` | string | 否 | webhook 路径 | `/` |

## Intent 说明

Intent 为 QQ 官方配置，使用 SDK 官方名（来自 `qq-official-bot` 的 `Intent` 联合类型）：

| 值 | 描述 |
|----|------|
| `GUILDS` | 频道变更事件 |
| `GUILD_MEMBERS` | 频道成员变更事件 |
| `GUILD_MESSAGES` | 私域机器人频道消息事件 |
| `PUBLIC_GUILD_MESSAGES` | 公域机器人频道消息事件 |
| `GUILD_MESSAGE_REACTIONS` | 频道消息表态事件 |
| `DIRECT_MESSAGE` | 频道私信事件 |
| `GROUP_AND_C2C_EVENT` | 群聊 @ 消息 与 私聊消息事件（v4 起合并） |
| `MESSAGE_AUDIT` | 消息审核事件 |
| `INTERACTION` | 互动事件 |
| `FORUMS_EVENT` | 论坛事件 |
| `AUDIO_ACTION` | 音频操作事件 |

旧名（启动时会一次性 warn 并自动转换，建议尽快改为新名）：

| 旧值 | 新值 |
|-----|------|
| `GROUP_AT_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT` |
| `C2C_MESSAGE_CREATE` | `GROUP_AND_C2C_EVENT` |
| `OPEN_FORUMS_EVENT` | `FORUMS_EVENT` |

## 连接模式

### WebSocket 模式（默认）

机器人主动连接 QQ 服务器，实时接收事件推送：

```yaml
qq.my_bot:
  mode: 'websocket'  # 可省略，默认值
  intents:
    - 'GROUP_AND_C2C_EVENT'
    - 'PUBLIC_GUILD_MESSAGES'
```

### Webhook 模式（v4 行为变更）

> ⚠️ **v4 起 Webhook 模式行为变化**：SDK 内部启动独立 HTTP 服务，不再挂载到 OneBots 主路由。

```yaml
qq.my_bot:
  mode: 'webhook'
  port: 18080               # 必填，监听端口（不能与 OneBots 主端口冲突）
  path: '/qq/webhook'       # 可选，路径，默认 '/'
```

事件推送地址（QQ 开放平台后台配置）：`http://<your-host>:18080/qq/webhook`

注意：

- `port` 必须配置；未配置会抛错
- Webhook 服务需要能被 QQ 服务器访问（生产环境一般用反代或隧道）

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

# QQ 官方机器人账号配置
qq.my_bot:
  # QQ 平台配置
  appid: 'your_app_id'        # v4 起改为 appid（小写 d）
  secret: 'your_secret'
  sandbox: false
  intents:
    - 'GROUP_AND_C2C_EVENT'
    - 'PUBLIC_GUILD_MESSAGES'

  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'qq_token'
```

## v3 → v4 迁移

| v3 | v4 |
|----|----|
| `appId` | `appid`（小写 d） |
| `token` | 删除（SDK 内部管理） |
| `maxRetry` | 删除（SDK 内部管理） |
| `logLevel` | 删除（SDK 内部管理） |
| webhook 模式挂载在 OneBots 主路由 `/qq/{account_id}/webhook` | 独立 HTTP 服务 `http://host:{port}/{path}`，需显式 `port` |
| intents 旧名（`GROUP_AT_MESSAGE_CREATE` 等） | SDK 新名（`GROUP_AND_C2C_EVENT` 等），旧名仍可使用但启动时 warn |

## 相关文档

- [QQ 平台说明](/platform/qq)
- [适配器配置指南](/guide/adapter)
- [客户端SDK使用指南](/guide/client-sdk)