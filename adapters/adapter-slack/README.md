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
  receive_mode: socket
  app_token: "xapp-YOUR-APP-TOKEN" # 需 connections:write
  proxy:
    url: "socks5://127.0.0.1:1080" # 可选；Web API 与 Socket Mode 共用
```

使用 HTTP Events API 时改为 `receive_mode: webhook` 并配置必需的 `signing_secret`。请求地址为账号路径下的 `/webhook`；适配器会校验原始请求体签名和五分钟时间窗。Web 管理端会按接收模式只显示相关凭据。

`receive_mode` 是接收方式的唯一来源；旧的 `socket_mode` 布尔字段已移除，不再保留双配置语义。

## 使用

```bash
onebots -r slack
```

## 功能

- HTTP Events API 与默认无限恢复的 Socket Mode
- Socket Mode 连接、重连与断开状态会同步到账号状态，普通 Web API 失败不会误判整号离线
- 频道、单人私信、多人私信（MPIM）、线程消息以及文本、@、回复、附件收发
- 用户目录按官方 `profile.display_name` / `profile.real_name` 投影真实显示名
- 消息查询、编辑、删除、定时消息、回复列表
- Reaction、Pin、频道生命周期、成员邀请与移除、Bookmark
- 消息编辑/删除、Reaction、成员变化等 canonical 事件投影
- Slash Command、交互载荷及其他未知事件的 `raw_event` 无损交付
- Slack Agent Sessions：生命周期状态、重命名、原生停止按钮与标题变更事件
- Events API、交互组件、Slash Command 与 Socket Mode 共用公开的 `SlackBot.ingest(rawEvent)` 入站管线；`ingestHttp(rawBody, headers)` 与 `acceptHttp(Request)` 可复用完整验签和 JSON / 表单解析
- Socket Mode 只在 canonical 投影与全部同步/异步监听器成功后确认 envelope；失败事件不会进入去重窗口，可由 Slack 重投
- Slack 重试事件保留每次 `raw_event`，仅在业务监听器成功后按 `event_id` / `envelope_id` / `trigger_id` 提交 canonical 去重状态；缺少原生 ID 时使用稳定载荷摘要
- Web API 失败统一抛出带 `code`、`category`、`operation` 与平台错误码的 `SlackError`

## 平台扩展 API

能力清单中的扩展动作可以从 OneBot 11/12、Milky、Satori 的统一动作入口调用：

`add_reaction`、`remove_reaction`、Pin、线程回复、频道生命周期与成员、定时消息及 Bookmark 动作；另提供临时消息、流式消息、消息永久链接与 unfurl、Block Kit 校验、Canvas 与访问控制、Slack Lists 的列表/记录/访问控制/异步下载、频道历史与已读标记、Modal/App Home View、Reaction/Pin 查询、文件列表、用户组及成员管理动作。Agent 应使用 `set_agent_session_status` 与 `rename_agent_session` 管理 Slack 当前的 Agent Sessions；适配器不会为已进入迁移期的 `assistant.threads.*` 另设兼容动作。文件详情与删除直接实现 canonical `get_file` / `delete_file`，无需使用平台扩展名。能力发现直接由同一份动作注册表生成，不会与实际调用入口漂移。

流式消息使用 `start_message_stream`、`append_message_stream`、`stop_message_stream` 三个闭合动作。它们支持 Slack 当前的 `markdown_text` 或结构化 `chunks` 内容模式；`chunks` 可承载 Markdown、task update、plan update 与 Block Kit。起始动作还支持 `task_display_mode: "timeline" | "plan"`、接收方身份和 `icon_emoji` / `icon_url` / `username`，停止动作支持结尾 blocks、metadata 与 Agent Session 状态。具名动作只接受各阶段的官方字段，且不能覆盖当前 Bot token；需要访问其他 Slack Web API 时使用 `call_slack_api`。

Slack Lists 动作使用 `create_list`、`update_list`、`*_list_access`、`*_list_download` 与 `*_list_item(s)` 命名，并一一固定映射到官方 `slackLists.*` 方法。读取动作声明 `lists:read`，写入动作声明 `lists:write`；Lists 仅在支持该功能的付费工作区可用。

外部会议系统可通过 `create_call`、`get_call`、`update_call`、`end_call` 与参与者动作接入 Slack Calls 的原生加入按钮和通话界面。远程文档系统可通过 `add_remote_file`、`get_remote_file`、`list_remote_files`、`update_remote_file`、`remove_remote_file`、`share_remote_file` 管理 Slack 的远程文件索引、预览和频道分享；它与普通文件上传使用不同的 `remote_files:*` scopes。

启用 Agent View 并订阅 `app_context_changed` 后，适配器会保留 Slack 按相关性排序的 active context：独立事件位于 `extensions.slack.context`，私信消息位于 `extensions.slack.app_context`，`app_home_opened` 同时保留 `tab`。频道、线程、Canvas 与 List 实体均保持官方结构，不会压成字符串。

创建频道与移除频道成员使用 canonical `create_channel`、`kick_channel_member`，参数分别为 `channel_name`，以及 `channel_id` + `user_id`。Slack 工作区由当前 Bot Token 隐式确定，因此 `create_channel` 的 `guild_id` 不参与平台请求。

未封装的 Slack Web API 可使用 `call_slack_api`：

```json
{
  "method": "conversations.history",
  "params": { "channel": "C123", "limit": 20 }
}
```

动作能否执行仍由当前 token scopes 和 Slack 会话上下文决定；`get_supported_actions` 只声明适配器已实现的调用路径。

已有 HTTP Host 可直接把标准 `Request` 交给 `bot.acceptHttp(request)`；其他 Node Host 可调用 `bot.ingestHttp(rawBody, { timestamp, signature, contentType })` 并把结构化的 `{ status, headers, body }` 写回。manual 模式只关闭 OneBots 自建路由或 Socket 连接；直接调用 `ingest(rawEvent)` 不再次验签，若要在 manual 模式复用 `acceptHttp()` / `ingestHttp()`，仍需配置 `signing_secret`。

Socket Mode 停止会始终通知本地 `stopped` 监听器；连接断开失败会保留为结构化错误并向账号生命周期传播。

## 消息与文件

`image`、`file`、`audio`、`video` 会使用 Slack 当前推荐的 `filesUploadV2` 原生上传，不再退化成附件 URL 或 `[文件: …]` 文本。媒体 `file` / `url` 支持 HTTP(S)、Node.js 本地路径、`file://`、Base64 data URL 与 `base64://`；上传文件需要 `files:write` scope。

Block Kit、传统 attachments 及其他 `chat.postMessage` 选项可通过 `slack_message` 段的 `data.body` 传入。未知消息段会明确失败。查询、编辑、删除消息时应提供 `scene_id`；当前进程已收发的消息会保存有界的频道/线程上下文，可省略该字段。

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
