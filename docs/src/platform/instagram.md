# Instagram Messaging

Instagram 适配器基于当前稳定的 **Instagram API with Instagram Login / Graph v25.0**。它直接使用 `graph.instagram.com` 和 Business Login for Instagram，不要求关联 Facebook Page，也不会另开监听端口。

## 能力映射

| Instagram | OneBots |
|---|---|
| Send API | direct 文本、回复、图片、视频与音频 |
| Quick Replies / Templates | 原生结构化消息段与平台动作 |
| Conversations / Messages | 单聊查找、最近消息详情与历史 |
| User Profile API | 已同意会话的 IGSID 用户资料 |
| message/edit/delete/read/reaction/postback | canonical message、status、reaction、interaction |
| referral/story reply/unsupported/comment | `custom` 或专用消息段，并完整保留 `raw_event` |

Instagram Professional Account 一次只能与一个用户对话，官方不支持群聊；适配器因此只声明 `direct` scene。Requests 文件夹中 30 天未活跃的会话不会由 API 返回；单个会话最多读取最近 20 条消息详情。opaque cursor 没有 canonical offset 等价语义时会明确拒绝。

## 平台扩展

具名动作覆盖普通 canonical 接口之外的官方能力：

- 原生 Send body、like-heart、published post `MEDIA_SHARE` 和消息 reaction；
- 按 IGSID 查找会话、会话列表和最近消息；
- Messenger Profile，包括 Persistent Menu 与 Ice Breakers 的原生结构；
- Professional Account webhook 的订阅、查询与删除；
- Welcome Message Flow 的列表、创建、更新和删除；
- 对评论发送一次 private reply；
- 经过审核的 Human Agent 发送；
- `call_instagram_api`：仅接受安全相对 Graph 路径的底层调用。

Human Agent 只能在用户消息后 7 天内由真实人工客服用于支持场景，不能用于自动化或无关内容。Private Reply 每条评论只能发送一次，须在评论后 7 天内发送；后续消息必须等用户回复，并受 24 小时窗口约束。适配器把两者保持为显式动作，不会暗中改变普通发送语义。

## 接收方式

- Webhook：复用 OneBots 主 HTTP Host，处理 GET challenge，并对精确 POST 字节验证 `X-Hub-Signature-256`。
- Manual：已有 consumer、队列或连接直接调用 `ingest(rawEvent)`。
- 嵌入：Fetch Host 调用 `acceptHttp(Request)`；框架 Host 调用 `ingestHttp()` 并传递 `rawBody`。

三种入口共用同一个严格 codec、batch 展开、事件过滤和可靠去重。只有全部异步监听器成功后 delivery 才会提交；失败响应允许 Meta 正常重试。

详细字段和 Web 表单说明见 [Instagram 配置](/config/adapter/instagram)。
