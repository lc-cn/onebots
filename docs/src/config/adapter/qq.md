# QQ 适配器配置

QQ 官方机器人适配器使用腾讯官方 `@tencent-connect/qqbot-nodejs` SDK。WebSocket 和 Webhook 共享完全相同的事件与 API 投影。

## 基础配置

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  receive_mode: websocket
  markdown_support: false
  intents:
    - GROUP_AND_C2C_EVENT
    - INTERACTION
    - PUBLIC_GUILD_MESSAGES
```

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `appid` | string | 必填 | QQ 开放平台 AppID |
| `secret` | string | 必填 | QQ 开放平台 AppSecret |
| `receive_mode` | `websocket \| webhook \| manual` | `websocket` | 事件接收方式 |
| `intents` | string[] | SDK 安全默认值 | 已获批的 Gateway Intent |
| `markdown_support` | boolean | `false` | 机器人是否已开通 Markdown 权限 |
| `webhook_path` | string | `/qq/{account_id}/webhook` | OneBots 主服务上的回调路径 |
| `api_base_url` | string | SDK 默认值 | OpenAPI 兼容代理或测试端点 |
| `token_base_url` | string | SDK 默认值 | Token 兼容代理或测试端点 |

## Webhook

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  receive_mode: webhook
  webhook_path: '/qq/my_bot/webhook'
```

回调直接挂载在 OneBots 主端口，不需要也不允许再配置独立监听端口。生产环境回调示例：`https://bot.example.com/qq/my_bot/webhook`。

QQ 使用原始 HTTP 请求体进行 Ed25519 验签。反向代理和请求中间件必须保留 `rawBody`；如果只留下解析后的 JSON，对应请求会以结构化 `QQ_WEBHOOK_RAW_BODY_REQUIRED` 错误拒绝。

已有 HTTP Host 可选择 `manual`，由宿主把原始请求交给 `account.client.ingest(request)` 或 `acceptHttp(ctx)`；该模式不注册 OneBots 路由，也不另开端口。

## Intent

Web 表单提供以下官方订阅项：`GUILDS`、`GUILD_MEMBERS`、`GUILD_MESSAGES`、`GUILD_MESSAGE_REACTIONS`、`DIRECT_MESSAGE`、`GROUP_MEMBER`、`GROUP_AND_C2C_EVENT`、`INTERACTION`、`MESSAGE_AUDIT`、`FORUMS_EVENT`、`AUDIO_ACTION`、`PUBLIC_GUILD_MESSAGES`。

只选择机器人已在 QQ 开放平台获批的 Intent。管理端以多选列表生成配置，重复项和未知项会在启动前拒绝；留空时使用腾讯 SDK 的安全默认组合。旧 intent 别名不会自动转换。

适配器会在启动接收 transport 前通过 `/users/@me` 验证机器人身份。事件 `bot_id`、状态列表和登录资料均使用平台返回的真实 ID，不会把 OneBots 内部账号别名冒充为平台身份。

## 平台扩展

适配器提供角色、权限、公告、表态、日程、帖子、音频控制、群申请与群发言限制等具名平台动作。尚未具名封装的新接口可通过 `qq_call` 调用：

```json
{
  "method": "POST",
  "path": "/guilds/{guild_id}/announces",
  "body": {
    "channel_id": "channel_id",
    "message_id": "message_id"
  }
}
```

`path` 必须是以单个 `/` 开头的相对路径。Client 统一负责认证、令牌刷新、限流与结构化 API 错误。
