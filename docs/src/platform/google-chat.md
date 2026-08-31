# Google Chat

Google Chat 适配器基于当前官方稳定 REST v1、Chat interaction event 与 Google Workspace Events API。一个可嵌入的 `GoogleChatClient` 统一负责鉴权、外部数据校验、去重和事件投影；它不会自行监听端口。

## 能力映射

| Google Chat | OneBots |
|---|---|
| Message create/get/list/patch/delete | 消息发送、查询、历史、编辑、删除 |
| Space list/get/patch | 群列表、群资料、群名称 |
| Membership list/create/delete | 成员查询、邀请、移除、离开 |
| Reaction create/delete | 消息 reaction |
| Attachment upload/download | 用户 OAuth `upload_file` + typed `downloadMedia()` |
| Space/thread read state | `message_status` 事件与用户身份 `mark_message_as_read` |
| Interaction cards/commands/dialogs | `custom` canonical 事件 + 无损 `raw_event` |
| Workspace message/reaction/membership/space events | 对应 canonical notice/message |

Google Chat 没有通用的 `users.get`。`get_user_info` 只返回已在 interaction、message 或 membership 中严格解析并缓存的用户，缺少上下文时明确返回错误，不伪造资料。消息来自仅含 Space 名称的 Workspace event 时，Client 会调用 `spaces.get` 闭合 `DIRECT_MESSAGE`/群聊场景，不把未知会话猜成群聊。

## 原生扩展动作

适配器导出闭合的 `GOOGLE_CHAT_PLATFORM_ACTIONS`，包括：

- `call_google_chat_api`：调用安全的相对 REST v1 路径；
- `find_google_chat_direct_message`、`find_google_chat_group_chats`；
- `setup_google_chat_space`、`create_google_chat_space`、`delete_google_chat_space`；
- `list_google_chat_space_events`；
- `get_google_chat_availability`、`mark_google_chat_active`、`mark_google_chat_away`、`mark_google_chat_do_not_disturb`；
- `get_google_chat_space_read_state`、`get_google_chat_thread_read_state`；
- `list_google_chat_reactions`；
- `send_google_chat_rich_message`：发送 cardsV2/accessoryWidgets 等原生消息体。

`messagePins` 和 custom emoji 当前仍属于 Google Workspace Developer Preview，因此不进入稳定具名动作；确实加入预览计划的应用可通过底层 `call_google_chat_api` 自行承担版本风险。

应用自行离开 Space 时使用官方 `spaces/{space}/members/app` 资源；用户 OAuth 的 `principal_name` 若用于 `leave_group`，应配置为可解析的 `users/{id|email}`，不能用无法映射到 membership resource 的 `users/me`。上传附件用用户 OAuth；下载则通过 typed `downloadMedia()` 返回原始字节。

## 接收语义

- Interaction HTTPS：验证 Google Chat 系统服务账号签发的 OIDC token，或验证官方自签 JWT；可同步返回 Message/dialog 响应。
- Workspace Events + Pub/Sub push：验证订阅配置的 push service account OIDC 身份，展开 batch，并在下游处理成功后 ACK。
- Manual：已有 Host、Pub/Sub consumer 或连接调用 `ingest(rawEvent)`，与内置入口共用同一个 Client。

配置、OAuth scope 和 Google Cloud 操作见 [Google Chat 配置](/config/adapter/google-chat)。
