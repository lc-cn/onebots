# Microsoft Teams 适配器

`@onebots/adapter-teams` 基于 Microsoft 365 Agents SDK 1.8.1、Teams API 2.0.15、Connector API 与 Microsoft Graph。它不依赖旧 Bot Framework SDK，也不会自行启动第二个 HTTP 服务。

## 配置

```yaml
teams.work-agent:
  account_id: work-agent
  app_id: "Microsoft Entra Client ID"
  app_password: "Client Secret Value"
  tenant_id: "Tenant ID"
  receive_mode: webhook # webhook 或 manual
```

Webhook 模式默认挂载 `/teams/{account_id}/webhook`。Azure Bot 的 Messaging endpoint 应直接指向公网 HTTPS 地址，例如 `https://bot.example/teams/work-agent/webhook`；反向代理必须保留 `Authorization` 和 JSON 请求体。

`manual` 模式不注册路由。已有 Host 可调用 `account.client.ingestHttp({ method, headers, body })` 获取结构化响应，Fetch/WinterCG Host 可直接调用 `acceptHttp(request)`，Koa Host 可调用 `acceptHttp(ctx)`。这些入口复用同一 JWT 认证、ConversationReference 和可靠事件管线。

主权云可配置 `authority_endpoint`、`graph_base_url` 与 `bot_audience`。`allowed_service_urls` 只用于额外可信 Connector，生产环境应保持 `validate_service_url: true`。

## 会话和原生能力

Teams 主动消息依赖完整 `ConversationReference`，而不只是 conversation ID。适配器持久化 `serviceUrl`、tenant、bot/user 和会话层级，因此重启后仍可主动发送；未见过的会话不会伪造上下文。

- 私聊、groupChat 和 team channel 使用不同场景，不把频道压扁成 canonical Group。
- 支持文本、mention、线程回复、引用回复、媒体链接、Adaptive Card、Bot Card、建议操作和完整原生 Activity。
- `teams_quote` 双向保留官方 `quotedReply` entity，可按消息顺序引用一条或多条历史消息；它与 `replyToId` 的线程语义保持独立。
- 支持消息更新/删除、Reaction、targeted message、会议上下文、成员目录、文件 consent 上传与 Azure Bot OAuth。
- `call_graph_api` 提供受约束的相对路径 Graph 入口；app-only 权限不能冒充用户发送普通聊天消息。

`teams_activity` 段保留 AI 生成标签、最多 20 条引用、敏感度、反馈回路、流信息、通知投递和建议操作。媒体附件必须是 Teams 可访问的 HTTPS URL；个人聊天的真实文件上传使用 file consent 流程，频道和群聊文件使用 Graph/SharePoint 权限。

## 事件

消息、编辑、删除、成员进出和 Reaction 均投影为对应标准事件。个人聊天的 `application/vnd.microsoft.readReceipt` 会投影为 `message_status`：`message_id` 与 `extensions.teams.last_read_message_id` 指向用户最后读到的消息。该事件需要在 Teams App Manifest 中授予 `ChatMessageReadReceipt.Read.Chat` RSC 权限，并受用户或管理员的 Read receipts 设置控制。

Invoke 投影为 `interaction`；安装生命周期在群会话中投影为 `group_increase/group_decrease`；typing、会议和未标准化 Activity 以 `custom` notice 无损交付。原始 Agents SDK Activity 始终保存在 `raw_event.raw_activity`。

## 相关链接

- [Microsoft 365 Agents SDK](https://learn.microsoft.com/microsoft-365/agents-sdk/)
- [Teams 引用回复与 Read Receipt](https://learn.microsoft.com/microsoftteams/platform/bots/build-conversational-capability)
- [Teams 文件](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/bots-filesv4)
- [客户端 SDK 使用指南](/guide/client-sdk)
