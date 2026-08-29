# @onebots/adapter-slack

onebots Slack 适配器

## 安装

```bash
pnpm add @onebots/adapter-slack
```

## 配置

在 `config.yaml` 中配置：

```yaml
slack.your_bot_id:
  token: "xoxb-YOUR-BOT-TOKEN"
  socket_mode: true
  app_token: "xapp-YOUR-APP-TOKEN" # 需 connections:write
```

使用 HTTP Events API 时改为 `socket_mode: false` 并配置 `signing_secret`。请求地址为账号路径下的 `/webhook`；启用 Signing Secret 后，适配器会校验原始请求体签名和五分钟时间窗。

## 使用

```bash
onebots -r slack
```

## 功能

- HTTP Events API 与自动重连的 Socket Mode
- 频道、私聊、线程消息以及文本、@、回复、附件接收
- 消息查询、编辑、删除、定时消息、回复列表
- Reaction、Pin、频道生命周期、成员邀请与移除、Bookmark
- 消息编辑/删除、Reaction、成员变化等 canonical 事件投影
- Slash Command、交互载荷及其他未知事件的 `raw_event` 无损交付

## 平台扩展 API

能力清单中的扩展动作可以从 OneBot 11/12、Milky、Satori 的统一动作入口调用：

`add_reaction`、`remove_reaction`、`add_pin`、`remove_pin`、`get_thread_replies`、`open_conversation`、`archive_channel`、`unarchive_channel`、`rename_channel`、`set_channel_topic`、`set_channel_purpose`、`join_channel`、`invite_channel_members`、`schedule_message`、`delete_scheduled_message`、`list_scheduled_messages` 以及 Bookmark 动作。

创建频道与移除频道成员使用 canonical `create_channel`、`kick_channel_member`，参数分别为 `channel_name`，以及 `channel_id` + `user_id`。Slack 工作区由当前 Bot Token 隐式确定，因此 `create_channel` 的 `guild_id` 不参与平台请求。

未封装的 Slack Web API 可使用 `call_slack_api`：

```json
{
  "method": "conversations.history",
  "params": { "channel": "C123", "limit": 20 }
}
```

动作能否执行仍由当前 token scopes 和 Slack 会话上下文决定；`get_supported_actions` 只声明适配器已实现的调用路径。

## 获取 Bot Token

1. 访问 [Slack API](https://api.slack.com/)
2. 创建应用（Create New App）
3. 在 "OAuth & Permissions" 中配置权限
4. 安装应用到工作区
5. 获取 Bot User OAuth Token（xoxb-...）
6. 在 "Event Subscriptions" 中配置 Webhook URL
7. HTTP Events 获取 Signing Secret；Socket Mode 创建包含 `connections:write` 的 App Token

## 相关链接

- [Slack Events API](https://docs.slack.dev/apis/events-api/)
- [Slack Web API 方法](https://docs.slack.dev/reference/methods/)
- [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- [OneBots 文档](https://onebots.pages.dev/)
