# @onebots/adapter-zulip

面向 Zulip 当前 REST API 与 Event Queue 的 OneBots 适配器。它使用官方 `POST /register` + `GET /events` 长轮询，不会创建不存在的 WebSocket 连接。

## 能力

- 频道、话题与单人/多人私聊消息
- 消息查询、历史、编辑、删除、narrow 匹配、批量标记与举报
- 定时消息、草稿、提醒与保存片段管理
- 用户组创建、权限更新、停用/恢复、成员与子组管理及成员关系查询
- Zulip-flavored Markdown、用户提及、Emoji、图片和文件上传
- 附件清单、删除、临时访问 URL、缩略图状态与实时生命周期事件
- 真实频道订阅者查询、邀请、移除、退订与频道改名
- 频道 ID、详情、话题、成员订阅状态、邮件入口与归档管理
- 消息反应、成员变更、心跳及未知原始事件投影
- 队列过期自动重建、无限指数退避、生命周期取消与成功后游标确认
- 独立可嵌入的 `ZulipClient`、底层 `call()` 与 `ingest(rawEvent)`
- HTTP/SOCKS 代理、结构化 `ZulipError` 和完整 TypeScript 类型

## 配置

```yaml
zulip.team-bot:
  server_url: https://example.zulipchat.com
  email: onebots-bot@example.zulipchat.com
  api_key: your-api-key
  default_topic: general
  receive_mode: event_queue

  event_queue:
    all_public_streams: false
    retry_initial_delay_ms: 1000
    retry_max_delay_ms: 30000

  onebot.v11:
    access_token: your-token
```

`server_url` 是组织根地址，不应包含 `/api/v1`。生产地址必须使用 HTTPS，仅本机回环地址允许 HTTP。`api_key` 在 Web 表单中按敏感字段处理。旧的 `serverUrl`、`apiKey`、`websocket` 和 `event_queue.enabled` 已移除；是否建立 Event Queue 统一由顶层 `receive_mode` 决定。

事件类型可在 Web 表单中直接增减；省略 `event_queue.event_types` 时订阅消息、编辑、删除、反应、频道、订阅、成员、用户组、在线状态和输入状态。队列始终无限恢复，不提供“重试若干次后永久离线”的选项。事件只有在全部 canonical 监听器成功返回后才推进队列游标并写入本地去重窗口；监听器抛错会保留原游标，让 Event Queue 重投，不会静默丢失业务事件。

停止会等待轮询退出并尝试删除服务端事件队列；任一步骤失败都会在本地代次清理完成后以结构化错误传播。

已有 Event Queue、消息代理或测试连接可配置 `receive_mode: manual`。客户端仍会调用 `users/me` 验证 API 凭据并缓存 Bot 身份，但不会注册或轮询服务器队列；外部系统通过 `await account.client.ingest(rawEvent)` 进入相同的可靠类型化事件管线。

## 场景 ID

- 频道：`stream_id/topic`，例如 `42/releases`。只有 `stream_id` 时使用 `default_topic`。
- 私聊：用户 ID，例如 `17`；多人私聊使用 `17,23`。

入站频道消息会把频道 ID 与原话题同时写入 `group.id`，因此直接回复不会丢失话题。频道名称可能变化，不作为稳定 ID。

## 独立 Client

```ts
import { ZulipClient } from "@onebots/adapter-zulip";

const client = new ZulipClient({
  account_id: "team-bot",
  server_url: "https://example.zulipchat.com",
  email: "onebots-bot@example.zulipchat.com",
  api_key: process.env.ZULIP_API_KEY!,
  receive_mode: "event_queue",
});

client.on("message", event => {
  console.log(event.message);
});
client.on("client_error", error => {
  console.error(error.code, error.message);
});

await client.start();
```

已有 Event Queue 或代理连接可调用 `await client.ingest(rawEvent)`，与内置长轮询共用同一事件管线。返回值表示本次调用是否完成首次投递；raw、精确类型和 canonical 监听器全部完成后才提交去重状态。`client.call(path, method, params)` 只允许当前组织 `/api/v1` 下的安全相对路径。

## 平台扩展动作

数据导出领域提供 `list_data_exports`、`create_data_export`、`delete_data_export` 与 `get_data_export_consents`，使用 Zulip 12 的字符串导出类型并保留跨服务器导出状态；默认订阅导出进度和成员授权变化，相关动作需要组织管理员权限。

Code Playground 领域提供 `add_code_playground` 与 `remove_code_playground`，只接受现代 RFC 6570 `url_template`，并默认订阅 `realm_playgrounds` 完整快照；Zulip 没有提供单独的列表或更新 REST API，因此不会暴露伪造动作。

允许域名领域提供 `list_allowed_domains`、`add_allowed_domain`、`update_allowed_domain` 与 `remove_allowed_domain`，并默认订阅增改删事件；写操作仅组织 Owner 可用。

Channel Folder 领域提供 `list_channel_folders`、`create_channel_folder`、`reorder_channel_folders` 与 `update_channel_folder`，完整覆盖创建、排序、资料更新、归档和恢复；写操作需要组织管理员权限。Client 默认订阅精确 `channel_folder` 事件，并投影为统一文件夹资源的创建、更新和排序通知。

Navigation View 领域提供 `list_navigation_views`、`add_navigation_view`、`update_navigation_view` 与 `remove_navigation_view`，安全编码 URL fragment，并闭合当前用户侧栏视图的精确创建、更新、删除事件。组织资源投影与共享事件基元已从主消息投影模块拆分，避免资源域继续膨胀单文件。

附件领域提供 `get_attachments`、`remove_attachment`、`get_attachment_temporary_url` 与 `check_attachment_thumbnail`；临时 URL 与缩略图动作按官方 `path_id` 拆分 `realm_id_str` 和 `filename`，每个路径段独立编码并拒绝路径穿越。Client 默认订阅 `attachment` 增改删事件，投影为统一附件资源通知，同时保留 `path_id`、空间使用量与原始事件。事件协议类型已独立到专用模块，REST 数据与队列报文不再共同推高单文件维护成本。

消息扩展领域提供 `update_message_flags`、`update_message_flags_for_narrow`、`check_messages_match_narrow` 与 `report_message`，并将原有反应、星标、历史、已读回执和 Markdown 渲染动作统一到独立消息模块。只允许客户端可修改的 `read`、`starred`、`collapsed` 标记；narrow 使用现代结构化条件，不暴露已弃用的全局已读端点。举报类型保留 Zulip 12 服务端动态 key，`other` 必须提供 1–1000 个 Unicode 字符的描述。Client 默认订阅精确 `update_message_flags` 事件，并投影为批量消息标记通知。

频道发现领域提供 `get_channel_id`、`get_channel_topics`、`get_channel_subscriptions`、`get_channel_subscription_status`、`get_user_channels`、`list_zulip_channels`、`get_zulip_channel`、`get_channel_email_address` 与 `delete_channel_topic`，并将原有订阅、订阅者、创建、更新和归档动作收敛到独立频道模块。频道列表仅暴露现代 `include_all` 等参数，不接受已弃用的 `include_all_active`；归档使用官方 `DELETE /streams/{stream_id}`，不再伪装成 PATCH 属性更新。话题删除保留 Zulip 10+ 的空话题名语义。

频道个人设置提供 `update_channel_subscription_settings` 和 `update_channel_subscription_property`，支持批量或单频道更新颜色、静音、置顶和通知开关。颜色严格校验为 6 位十六进制值，其余属性必须为布尔值；不接受仅为旧客户端保留的 `in_home_view`。

频道成员关系提供 `subscribe_channels`、`update_channel_subscriptions` 与 `unsubscribe_channels`，按官方结构校验频道描述、用户 principals、初始策略和权限组；频道资料更新支持 Zulip 10+ 的现代权限组变更对象。已移除的 `stream_post_policy`、`is_announcement_only` 不会继续透传。`stream` 创建、更新、删除以及 `subscription` 自身/其他成员变化均有精确 Client 类型，并投影为稳定的频道资源与订阅关系通知；批量事件会拆成逐频道、逐用户事件，原始报文仍完整保留。

当前账号资料领域提供 `get_own_user`、`update_own_profile_data`、`remove_own_profile_data`、`upload_own_avatar` 与 `delete_own_avatar`；资料值严格遵循 Zulip 自定义字段类型，头像上传复用统一媒体来源并使用官方 `file` multipart 字段。资料和头像变更可能受组织权限策略限制。

通过统一 `callAction` 可调用反应、星标、消息搜索与编辑历史、频道订阅/管理、话题可见性、Presence、用户状态、输入状态、定时消息、草稿、提醒、保存片段、附件和服务器信息等动作。自定义表情领域提供 `get_custom_emoji`、`upload_custom_emoji` 与 `deactivate_custom_emoji`；上传接受 `file`（HTTP(S)、data URL、`base64://` 或本地路径）及可选的 `filename`、`content_type`，并声明 Zulip 12 增量 Emoji 事件能力。自定义资料字段领域提供 `list_profile_fields`、`create_profile_field`、`update_profile_field`、`delete_profile_field` 与 `reorder_profile_fields`，闭合 8 种官方字段类型及 Zulip 12 的资料摘要、必填、用户可编辑和用户匹配约束，并默认订阅字段快照事件。个人偏好领域提供用户静音、Alert Words、状态读取与严格状态更新，并默认订阅对应集合变化；`update_status_for_user` 需要组织管理员权限。组织成员领域提供 `create_user`、`update_user`、`deactivate_user` 与 `reactivate_user`，严格校验官方角色、自定义资料和 Zulip 12 停用策略；这些动作需要组织管理员或服务器授予 Bot 相应特殊权限。邀请领域提供 `list_invitations`、`send_invitations`、`create_invitation_link`、`resend_email_invitation`、`revoke_email_invitation` 与 `revoke_invitation_link`，并默认订阅 `invites_changed` 以刷新邀请状态。Bot 领域提供 API Key 读取/再生成，以及 Zulip 12 Bot 专属的字符串存储读写删除；凭证动作需要 Bot 所有者或组织管理员权限。Linkifier 领域提供查询、创建、完整更新、删除和排序，并声明现代 URL Template 能力以接收 `realm_linkifiers` 事件；写操作需要组织管理员权限。用户组领域提供 `list_user_groups`、`create_user_group`、`update_user_group`、`deactivate_user_group`、`update_user_group_members`、`update_user_group_subgroups`、`get_user_group_members`、`get_user_group_subgroups` 与 `get_user_group_membership`。所有命名动作都会拒绝未知字段；`call_zulip_api` 仅用于尚未封装的官方端点，支持 GET、POST、PUT、PATCH、DELETE，且不会接受绝对 URL。

用户组创建、更新、停用/恢复会投影为标准 `user_group` 资源生命周期通知；成员和子组批量变化会拆成具有稳定 ID 的逐对象通知。自定义表情的增量创建和属性变化投影为标准 `emoji` 资源通知，停用保持 `emoji_updated/deactivated` 语义，因为 Zulip 仍会在历史消息中保留该资源。`custom_profile_fields` 是整表快照事件，Client 会提供精确类型监听，但不会将其猜测成某一个字段的生命周期。Zulip 未提供时间的 Event Queue 事件使用明确的时间戳 `0`，不会伪造本机接收时间。平台新增字段不会被丢弃：每个投影事件都保留 `raw_event`，未建立通用语义的事件会以 `notice_type: "custom"` 分发。

## 官方文档

- [Zulip REST API](https://zulip.com/api/rest)
- [Real-time events](https://zulip.com/api/real-time-events)
- [Register an event queue](https://zulip.com/api/register-queue)
