# @onebots/adapter-teams

Microsoft Teams 官方机器人适配器。基于 Microsoft 365 Agents SDK、Teams Connector API 和 Microsoft Graph，不再依赖已停止维护的 Bot Framework SDK。

## 配置

```yaml
teams:
  work-agent:
    account_id: work-agent
    app_id: your-microsoft-app-id
    app_password: your-client-secret-value
    tenant_id: your-tenant-id
    receive_mode: webhook
```

| 字段                   | 说明                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `account_id`           | OneBots 内部稳定账号标识                                         |
| `app_id`               | Azure Bot 绑定的 Microsoft Entra 应用 Client ID                  |
| `app_password`         | Entra 客户端密钥的值，不是 Secret ID                             |
| `tenant_id`            | 单租户填写 Tenant GUID；多租户 Azure Bot 留空                    |
| `receive_mode`         | `webhook` 由 OneBots 挂载路由；`manual` 由已有 Host 转交请求     |
| `webhook_path`         | Webhook 路径；留空使用 `/teams/{account_id}/webhook`             |
| `validate_service_url` | 校验 Activity serviceUrl 与 JWT claim，默认开启                  |
| `authority_endpoint`   | 主权云的 Entra Authority；普通 Microsoft 365 环境不填            |
| `graph_base_url`       | Graph 根地址，默认 `https://graph.microsoft.com/v1.0`            |
| `graph_tenant_id`      | 多租户 Bot 调用 app-only Graph 时使用的具体目标 Tenant           |
| `bot_audience`         | Connector audience；美国政府云使用 `https://api.botframework.us` |
| `allowed_service_urls` | 私有/自定义 Connector 的额外可信 HTTPS URL，可在 Web 动态增减    |

适配器不自行启动第二个 HTTP 服务，也没有需要手填的 `webhook.url` 或端口。Azure Bot 的 Messaging endpoint 直接配置为：

```text
https://你的域名/teams/work-agent/webhook
```

反向代理必须保留 `Authorization` 请求头和 JSON 请求体。生产环境不应关闭 `validate_service_url`。

若应用已有 HTTP Host，可配置 `receive_mode: manual`。OneBots 此时不注册路由；宿主调用 `account.client.ingestHttp({ method, headers, body })`，即可获得 `{ status, headers, body }` 结构化响应，并继续使用同一 Microsoft Agents SDK JWT 认证与 Turn 管线。Fetch/WinterCG 宿主可直接调用 `account.client.acceptHttp(request)` 获取标准 `Response`，Koa 风格宿主则调用 `account.client.acceptHttp(ctx)`。

## 会话模型

Teams 主动消息不能只依赖 conversation ID；微软要求同时保留 `serviceUrl`、bot/user、tenant 等 ConversationReference。适配器会在每个入站 Activity 上捕获真实引用，并存入 OneBots SQLite 数据库：

- 进程重启后仍能继续主动发送；
- 编辑和删除消息可由持久化的 message→conversation 上下文定位；
- 未见过的会话不会伪造引用，而是抛出 `TeamsConversationReferenceError`；
- 外部系统可通过 `register_conversation_reference` 导入可信引用；
- 首次主动私聊使用 `create_personal_conversation`，目标用户必须已安装 Teams 应用。

## 消息与事件

发送链路原生支持文本、Teams mention entity、回复、图片/音频/视频附件、Adaptive Card、Hero/Thumbnail 等 Bot Card，以及 `teams_activity` 扩展选项。媒体附件必须提供 Teams 服务端可访问的 HTTPS URL；未知段、无效卡片和本地/Base64 媒体会明确失败，不会静默丢失。

Teams 的“附件链接”和“真实文件上传”不是同一能力。个人聊天上传必须完成 file consent → OneDrive upload → file-info 卡片流程；频道和群聊文件依赖 Graph 与 SharePoint/OneDrive 权限。适配器为此提供 `send_file_consent_card`、`send_file_info_card` 和 `call_graph_api`，`file` 段也可用 `unique_id`、`file_type`、`name`、`url` 生成标准 file-info 卡片。

入站会保留 `serviceUrl`、recipient、tenant、team/channel、locale、reply、entities、attachments、reactions、value 和 channelData。消息编辑/删除、成员进出、反应增删会投影为对应统一 notice；群会话中明确的机器人安装/卸载投影为 `group_increase/group_decrease`，个人安装和其他 installation 动作仍保持 `custom`；invoke 投影为 `interaction`；typing、会议、read receipt 和其他 Activity 以 `custom` notice 无损交付。Agents SDK 原始 Activity 位于 `raw_event.raw_activity`，稳定投影位于 `raw_event.activity`，Teams 上下文位于 `extensions.teams`。

Webhook 与已有的、已认证 Agents SDK 连接可共用公开的 `TeamsBot.ingest(activity)` 入站管线。`ingestHttp()` 负责 Microsoft JWT 认证；`ingest(activity)` 只接收已由上游认证的 Activity。Connector 重试会继续触发 `raw_activity`，但同一 Activity ID 的 canonical 事件只投影一次；一个 Activity 携带多个 Reaction 时会逐项派发并生成不同事件 ID。

## 平台扩展动作

会话与主动消息：

- `get_conversation_reference`、`list_conversation_references`
- `register_conversation_reference`
- `create_personal_conversation`：`service_url`、`tenant_id`、`aad_object_id`、`message`
- `send_adaptive_card`：`conversation_id`、`card`
- `send_targeted_message`：`conversation_id`、`message`，可用 `user_id` 指定仅其可见的成员
- `send_typing`：`conversation_id`

文件与卡片：

- `send_file_consent_card`：`conversation_id`、`file_name`、`size_in_bytes`，可带 accept/decline context
- `send_file_info_card`：上传完成后发送文件信息，需 `unique_id`、`file_type`、`file_name`、`content_url`
- `complete_file_consent_upload`：在收到 consent accept invoke 后，用 `source`（支持 URL、本地路径、data URL、`base64://`）上传到 `upload_url`，再以 `content_url`、`unique_id`、`file_type`、`file_name` 发送 file-info 卡片

Teams Connector：

- `get_team_details`、`list_team_channels`
- `get_conversation_member`、`list_conversation_members`、`list_conversation_members_paged`
- `get_activity_members`：查询某条 Activity 的可见成员
- `add_message_reaction`、`remove_message_reaction`
- `get_meeting_info`、`get_meeting_participant`
- `send_meeting_notification`，需要 `OnlineMeetingNotification.Send.Chat` RSC 权限

Azure Bot OAuth：

- `get_user_token`、`get_user_aad_tokens`、`get_user_token_status`
- `exchange_user_token`、`sign_out_user`

Microsoft Graph：

- `call_graph_api`：安全相对 `path`、`method`、`query`、`body`

Graph 使用应用凭据流，必须有具体 Tenant ID：单租户复用 `tenant_id`，多租户 Bot 单独填写 `graph_tenant_id`。并发请求复用同一次 token 获取，401 只刷新并重试一次；公开 Graph 入口在最底层拒绝 query、fragment、编码分隔符与路径穿越。它只能调用管理员已授予相应 application permission 的资源。普通发送聊天消息不能用 app-only Graph 权限冒充；消息发送仍通过 Teams Connector 完成。

认证、Connector 和 Graph 错误统一抛出继承 OneBots 错误体系的 `TeamsApiError`，包含稳定 `code`、`category`、调用 `operation`、HTTP `status` 与 `details`；微软返回的动态错误码单独保存在 `platformCode`，不会污染稳定错误码。

## 官方参考

- [Microsoft 365 Agents SDK](https://learn.microsoft.com/microsoft-365/agents-sdk/)
- [Node.js 迁移指南](https://learn.microsoft.com/microsoft-365/agents-sdk/bf-migration-nodejs)
- [Teams 主动消息](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages)
- [Teams 文件](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/bots-filesv4)
- [Teams RSC 权限](https://learn.microsoft.com/microsoftteams/platform/graph-api/app-permissions/teams-app-permissions)
