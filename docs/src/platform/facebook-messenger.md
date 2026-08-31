# Facebook Messenger

Facebook Messenger 适配器基于当前稳定 Messenger Platform / Graph v25.0。可嵌入的 `FacebookMessengerClient` 统一负责 Graph 调用、严格外部数据校验、Webhook 签名、batch 展开、可靠去重和事件投影；它不会自行监听端口。

## 能力映射

| Messenger Platform | OneBots |
|---|---|
| Send API / sender actions | 发送消息、已读和输入状态 |
| Attachment Upload | 图片、视频、音频、文件上传 |
| Conversations / Messages | 消息查询和一对一历史 |
| User / Page Profile | 用户资料和机器人身份 |
| message/edit/delivery/read/reaction/postback | canonical message、status、reaction、interaction |
| referrals/opt-ins/handover/policy/feedback | `custom` 事件并保留完整 `raw_event` |

Messenger Page 与 PSID 是一对一会话，因此适配器只声明 `direct` scene，不伪造群聊语义。Conversations 使用不透明 cursor；canonical offset/start message 没有等价语义时会明确拒绝。

## 平台扩展

除 canonical API 外，适配器提供具名动作覆盖：

- 原生消息体、sender action、附件上传；
- 会话列表、按 PSID 查会话、完整会话和消息历史；
- Messenger Profile 的读取、设置和删除；
- Page webhook subscription 与 subscribed apps；
- conversation moderation 与 Handover Protocol；
- Utility Messaging 模板库搜索、Page 模板查询/创建和 `UTILITY` 发送；
- `call_facebook_messenger_api`：只接受安全相对 Graph 路径的底层调用。

Utility Messaging 需要 `page_utility_messaging`，且受 Meta 支持地区、非营销用途和模板审核规则约束。适配器不会把 `UTILITY` 设为普通消息默认类型。

## 接收方式

- Webhook：复用 OneBots 主 HTTP Host，处理 GET challenge，并对 POST 的精确原始字节校验 `X-Hub-Signature-256`。
- Manual：已有 Webhook consumer、队列或连接调用 `ingest(rawEvent)`，与 Webhook 共用 codec、去重和事件投影。
- 嵌入：Fetch Host 调用 `acceptHttp(Request)`；框架 Host 调用 `ingestHttp()` 并传递 `rawBody`。

只有全部异步业务监听器成功后 delivery 才会提交去重；失败返回非 2xx，让 Meta 正常重试。

详细配置与 Web 表单说明见 [Facebook Messenger 配置](/config/adapter/facebook-messenger)。
