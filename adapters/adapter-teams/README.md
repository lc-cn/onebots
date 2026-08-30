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

发送链路原生支持文本、Teams mention entity、回复、图片/音频/视频附件、Adaptive Card、Hero/Thumbnail 等 Bot Card，以及双向 `teams_activity` 扩展。后者集中承载 `entities`、`channel_data`、`suggested_actions`、locale、通知投递、附件布局和自定义 value，可表达 AI 生成标签、引用、敏感度标签、反馈按钮与流信息；接收时非 mention entity 和这些顶层字段也会投影回同一个段，不必从原始 Activity 中重新拼装。媒体附件必须提供 Teams 服务端可访问的 HTTPS URL；未知段、无效卡片和本地/Base64 媒体会明确失败，不会静默丢失。

下面的消息会显示 Teams AI 标签、引用、默认反馈按钮和一个建议操作：

```json
[
  { "type": "text", "data": { "text": "结论 [1]" } },
  {
    "type": "teams_activity",
    "data": {
      "entities": [
        {
          "type": "https://schema.org/Message",
          "@type": "Message",
          "additionalType": ["AIGeneratedContent"],
          "citation": [
            {
              "@type": "Claim",
              "position": 1,
              "appearance": {
                "@type": "DigitalDocument",
                "name": "官方规范",
                "abstract": "引用摘要",
                "url": "https://learn.microsoft.com/"
              }
            }
          ]
        }
      ],
      "channel_data": { "feedbackLoop": { "type": "default" } },
      "suggested_actions": {
        "actions": [{ "type": "imBack", "title": "继续", "value": "继续" }]
      }
    }
  }
]
```

微软限制单条消息只有一个根 Message entity、最多 20 条引用、最多 3 个建议操作，且建议操作不能与附件一起发送；适配器会在请求到达 Connector 前明确校验这些约束。

Teams 的“附件链接”和“真实文件上传”不是同一能力。个人聊天上传必须完成 file consent → OneDrive upload → file-info 卡片流程；频道和群聊文件依赖 Graph 与 SharePoint/OneDrive 权限。适配器为此提供 `send_file_consent_card`、`send_file_info_card` 和 `call_graph_api`，`file` 段也可用 `unique_id`、`file_type`、`name`、`url` 生成标准 file-info 卡片。

入站会保留 `serviceUrl`、recipient、tenant、team/channel、locale、reply、entities、attachments、reactions、value 和 channelData。消息编辑/删除、成员进出、反应增删会投影为对应统一 notice；群会话中明确的机器人安装/卸载投影为 `group_increase/group_decrease`，个人安装和其他 installation 动作仍保持 `custom`；invoke 投影为 `interaction`；typing、会议、read receipt 和其他 Activity 以 `custom` notice 无损交付。Agents SDK 原始 Activity 位于 `raw_event.raw_activity`，稳定投影位于 `raw_event.activity`，Teams 上下文位于 `extensions.teams`。

Webhook 与已有的、已认证 Agents SDK 连接可共用公开的 `await TeamsBot.ingest(activity)` 入站管线。`ingestHttp()` 负责 Microsoft JWT 认证；`ingest(activity)` 只接收已由上游认证的 Activity。入口会等待 canonical 事件抵达全部协议出口后才确认成功；失败不会提交去重状态，可由 Connector 安全重试。并发的相同 Activity 会合并为一次投递；缺少 ID 的 Activity 使用稳定载荷指纹生成身份。`raw_activity` 仍会记录每次接收，一个 Activity 携带多个成员或 Reaction 时会逐项派发并生成不同事件 ID。

`start()` 与 `stop()` 会等待全部异步生命周期监听器完成，宿主可据此安全地编排协议注册、资源释放和进程退出。

`adaptiveCard/action`（Adaptive Card `Action.Execute`）默认返回符合 Universal Action Model 的 Invoke 响应。业务需要动态刷新卡片、鉴权或返回自定义状态时，可使用 `bot.setInvokeHandler(handler)` 注册唯一处理器，并用 `createAdaptiveCardInvokeResponse()` / `createAdaptiveCardMessageResponse()` 构造响应。成功响应按 Activity ID 缓存，Microsoft 重投不会重复执行处理器；更换处理器会建立新的缓存代际。未注册处理器的其他 Invoke 类型保持 Agents SDK 的明确 `501`，不会伪造成功。

## 平台扩展动作

会话与主动消息：

- `get_conversation_reference`、`list_conversation_references`
- `register_conversation_reference`
- `create_personal_conversation`：`service_url`、`tenant_id`、`aad_object_id`、`message`
- `send_adaptive_card`：`conversation_id`、`card`
- `send_activity`：`conversation_id`、`activity`；发送由可信会话上下文补全路由的原生 Activity，适用于流式消息和新 Activity 扩展，禁止覆盖 `serviceUrl`、收发者与会话身份
- `send_targeted_message`：`conversation_id`、`message`，可用 `user_id` 指定仅其可见的成员
- `reply_to_activity`：使用当前 Connector 扁平 API 回复指定 Activity
- `create_targeted_activity`、`update_targeted_activity`、`delete_targeted_activity`：完整的 targeted Activity 生命周期，直接接收官方 `activity` 对象
- `send_typing`：`conversation_id`

文件与卡片：

- `send_file_consent_card`：`conversation_id`、`file_name`、`size_in_bytes`，可带 accept/decline context
- `send_file_info_card`：上传完成后发送文件信息，需 `unique_id`、`file_type`、`file_name`、`content_url`
- `complete_file_consent_upload`：传入已认证 consent accept 事件的 `consent_activity_id` 与 `source`（支持 URL、本地路径、data URL、`base64://`）；适配器从该事件派生一次性 `uploadUrl`、会话与 file-info 元数据，不接受调用方指定上传目标

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

平台动作按 Conversation/Connector、OAuth 与 Graph 拆分为独立领域模块，能力发现直接由同一注册表生成。已提供但类型错误的可选参数会返回结构化 `TEAMS_PARAM_INVALID`，不会被静默忽略。

认证、Connector 和 Graph 错误统一抛出继承 OneBots 错误体系的 `TeamsApiError`，包含稳定 `code`、`category`、调用 `operation`、HTTP `status` 与 `details`；微软返回的动态错误码单独保存在 `platformCode`，不会污染稳定错误码。

## 官方参考

- [Microsoft 365 Agents SDK](https://learn.microsoft.com/microsoft-365/agents-sdk/)
- [Node.js 迁移指南](https://learn.microsoft.com/microsoft-365/agents-sdk/bf-migration-nodejs)
- [Teams 主动消息](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages)
- [Adaptive Card Universal Action Model](https://learn.microsoft.com/adaptive-cards/authoring-cards/universal-action-model)
- [AI 生成消息、引用与反馈](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/bot-messages-ai-generated-content)
- [流式消息](https://learn.microsoft.com/microsoftteams/platform/bots/streaming-ux)
- [建议操作](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/conversations/suggested-actions)
- [Teams 文件](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/bots-filesv4)
- [Teams RSC 权限](https://learn.microsoft.com/microsoftteams/platform/graph-api/app-permissions/teams-app-permissions)
