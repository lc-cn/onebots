# @onebots/adapter-zulip

面向 Zulip 当前 REST API 与 Event Queue 的 OneBots 适配器。它使用官方 `POST /register` + `GET /events` 长轮询，不会创建不存在的 WebSocket 连接。

## 能力

- 频道、话题与单人/多人私聊消息
- 消息查询、历史、编辑、删除、已读与星标
- 定时消息、草稿、提醒与保存片段管理
- 用户组创建、权限更新、停用/恢复、成员与子组管理及成员关系查询
- Zulip-flavored Markdown、用户提及、Emoji、图片和文件上传
- 真实频道订阅者查询、邀请、移除、退订与频道改名
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

通过统一 `callAction` 可调用反应、星标、消息搜索与编辑历史、频道订阅/管理、话题可见性、Presence、用户状态、输入状态、定时消息、草稿、提醒、保存片段、附件、Emoji 和服务器信息等动作。个人偏好领域提供用户静音、Alert Words、状态读取与严格状态更新，并默认订阅对应集合变化；`update_status_for_user` 需要组织管理员权限。组织成员领域提供 `create_user`、`update_user`、`deactivate_user` 与 `reactivate_user`，严格校验官方角色、自定义资料和 Zulip 12 停用策略；这些动作需要组织管理员或服务器授予 Bot 相应特殊权限。邀请领域提供 `list_invitations`、`send_invitations`、`create_invitation_link`、`resend_email_invitation`、`revoke_email_invitation` 与 `revoke_invitation_link`，并默认订阅 `invites_changed` 以刷新邀请状态。Bot 领域提供 API Key 读取/再生成，以及 Zulip 12 Bot 专属的字符串存储读写删除；凭证动作需要 Bot 所有者或组织管理员权限。用户组领域提供 `list_user_groups`、`create_user_group`、`update_user_group`、`deactivate_user_group`、`update_user_group_members`、`update_user_group_subgroups`、`get_user_group_members`、`get_user_group_subgroups` 与 `get_user_group_membership`。所有命名动作都会拒绝未知字段；`call_zulip_api` 仅用于尚未封装的官方端点，支持 GET、POST、PUT、PATCH、DELETE，且不会接受绝对 URL。

用户组创建、更新、停用/恢复会投影为标准 `user_group` 资源生命周期通知；成员和子组批量变化会拆成具有稳定 ID 的逐对象通知。Zulip 未提供时间的 Event Queue 事件使用明确的时间戳 `0`，不会伪造本机接收时间。平台新增字段不会被丢弃：每个投影事件都保留 `raw_event`，未建立通用语义的事件会以 `notice_type: "custom"` 分发。

## 官方文档

- [Zulip REST API](https://zulip.com/api/rest)
- [Real-time events](https://zulip.com/api/real-time-events)
- [Register an event queue](https://zulip.com/api/register-queue)
