# @onebots/adapter-whatsapp

基于 Meta 官方 WhatsApp Cloud API 的 OneBots 适配器。它复用 OneBots HTTP Host 接收 Webhook，不会自行监听额外端口。

## 能力

- 发送和接收文本、回复、图片、视频、音频、文档、Sticker、位置、联系人、Reaction
- 支持符合资格的 Official Business Account 使用 Groups API：群消息、群资料/成员、改名、参与者增删、邀请链接与入群审批
- 将群成员增减和入群申请投影为 canonical 事件，生命周期、设置和冻结状态作为结构化群更新交付
- 通过 `whatsapp_message` 原生段发送 Template、Interactive、Flow 等完整 Cloud API 消息
- 展开同一 Webhook 批次中的全部消息和状态，未知 change 也作为原始事件交付
- 一个 App Webhook 承载多个号码时，按 `metadata.phone_number_id` 自动分流到对应 Client
- 将投递、已读、失败投影为明确的 `message_status`，不会与消息内容编辑混淆
- 将 Reaction 增删投影为 canonical `reaction_added` / `reaction_removed` notice
- 使用原始请求体校验 `X-Hub-Signature-256`，并过滤 Meta 重投递
- 媒体上传、查询、下载、删除，消息已读与 typing indicator
- Business Profile、Commerce、Flow 生命周期、号码注册、两步验证、用户屏蔽和消息模板管理
- Conversational Automation：欢迎消息、引导问题和 Bot 命令配置
- Calling API 权限查询/申请，以及 `connect`、`pre_accept`、`accept`、`reject`、`terminate` 信令控制
- 消息投递历史：按 WAMID 查询状态、Webhook 更新结果与可完整遍历的事件时间线
- 号码级设置：Calling/SIP/视频、身份变更通知、payload encryption 公钥与数据驻留
- Payload Encryption 加密消息：固定端点、compact JWE 结构校验与加密响应校验
- 号码生命周期：状态资料、注册/注销、两步验证、短信或语音验证码申请与校验
- Business Encryption：Flow/data-channel RSA 公钥上传、读取与签名状态校验
- Business Profile：强类型资料读取、字段选择、更新约束与 Resumable Upload 头像 handle
- 通用 `whatsapp_call`，无需等待适配器升级即可调用新的 Graph API 资源
- `ingest()`、`ingestHttp()` 与标准 `acceptHttp(Request)` 共用同一 typed 事件和去重链路

`getUserInfo` 只返回 Webhook 中真实观察到的联系人名称；Cloud API 不提供任意号码资料查询，尚未出现过的号码会返回结构化 `WHATSAPP_USER_NOT_OBSERVED`，不会用号码伪造用户资料。

通用 `image`、`video`、`audio`、`file`、`sticker` 段可直接使用 `media_id` 或公开 HTTPS URL；本地路径、HTTP URL、data URL 与 `base64://` 会先上传到当前 Phone Number，再用真实 media ID 发送。`template` 与 `interactive` 可直接作为结构化消息段发送，也可使用 `whatsapp_message` 承载任意原生负载。一条通用消息拆成多个 Cloud API 请求时，所有请求都会保留同一个 `reply` 上下文。

媒体资产统一通过 `client.media` 管理。上传按官方 MIME 类型与大小上限在请求前校验；查询和删除始终携带当前 `phone_number_id`，避免误操作其他号码的媒体；元数据保留官方字符串 `file_size`，下载只会向配置的 Graph Origin 或 Meta 官方媒体域发送 Bearer Token。`delete_media` 返回经过校验的 `{ success: true }`，不再丢弃平台响应。

## 配置

```yaml
whatsapp.my_bot:
  phone_number_id: "your_phone_number_id"
  business_account_id: "your_business_account_id"
  access_token: "your_long_lived_access_token"
  app_secret: "your_meta_app_secret"
  webhook_verify_token: "your_random_verify_token"
  receive_mode: webhook
  api_version: "v23.0"

  onebot.v11:
    access_token: "your_onebots_token"
```

默认回调路径是 `/whatsapp/my_bot/webhook`。将完整公网地址和同一个 `webhook_verify_token` 填入 Meta App Dashboard，并订阅 `messages` 字段。使用 Groups API 时还要订阅 v23 定义的 `group_lifecycle_update`、`group_participant_update`、`group_settings_update`。Koa 请求解析器必须保留未经修改的 `rawBody`，否则适配器会拒绝无法验签的请求。

配置只使用上面的 snake_case 字段；旧的 camelCase、`webhook.url`、`webhook.fields` 和适配器私有代理配置不再使用。

已有 Host、队列或代理已经负责接收事件时，使用 manual 模式，不会在 OneBots Router 上注册额外路由：

```yaml
whatsapp.my_bot:
  phone_number_id: "your_phone_number_id"
  business_account_id: "your_business_account_id"
  access_token: "your_long_lived_access_token"
  # 复用标准 HTTP 接入时填写；只调用 ingest(rawEvent) 时可省略
  app_secret: "your_meta_app_secret"
  webhook_verify_token: "your_random_verify_token"
  api_version: "v23.0"
  receive_mode: manual
```

三层接入最终进入同一个 `WhatsAppClient`，共享联系人观察、typed events 与去重状态：

```ts
const result = await client.ingest(rawEvent);
const verified = await client.ingestHttp(rawBody, xHubSignature256);
const response = await client.acceptHttp(request);

client.on("message", async (message, metadata, change) => {
  // 参数均保留 Cloud API 原始类型
});
```

`ingest()` 与 `ingestHttp()` 会按原始批次顺序尝试全部同步/异步监听器和事件视图，成功后才提交去重并返回 `{ accepted, duplicate, changes, messages, statuses, event }`；某个出口失败不会截断其他 typed handler，并发的同一载荷只执行一次业务投递。`acceptHttp()` 返回可直接交给 Fetch/WinterCG Host 的结构化响应，业务失败返回 500 以触发 Meta 重投。

## 原生消息

```ts
await adapter.callAction("my_bot", "send_native_message", {
  message: {
    to: "8613800138000",
    type: "template",
    template: {
      name: "hello_world",
      language: { code: "en_US" },
    },
  },
});
```

## 通用 Graph API

```ts
await adapter.callAction("my_bot", "whatsapp_call", {
  method: "GET",
  resource: "your-waba-id/message_templates",
  query: { limit: 50 },
});
```

`resource` 只能是相对 Graph API 路径，适配器拒绝绝对 URL，避免 Access Token 被发送到未配置域名。HTTP 和业务错误会抛出 `WhatsAppApiError`，其中保留 `code`、`status`、`resource` 与 Meta 错误详情。

Flow 通过强类型 `client.flows` 管理。固定动作覆盖列表、multipart 创建与元数据更新、跨 WABA 迁移、受限字段查询、预览刷新、endpoint metrics、Flow JSON 上传与资产列表，以及发布、弃用和删除。分类、字段、指标表达式、响应与 JSON 可序列化性均在请求边界校验；权限仍由 Meta 的 `whatsapp_business_management` scope 决定。Commerce 设置以及消息二维码的增查改删也提供固定资源动作；Commerce 可通过 `client.commerce` 使用，读取响应会校验官方 `data` 数组，更新仅接受购物车与目录可见性布尔字段，并拒绝空操作或任意附加参数。

消息二维码通过 `client.qrCodes` 或 `list_qr_codes` / `get_qr_code` / `create_qr_code` / `update_qr_code` / `delete_qr_code` 管理。查询 `fields` 是可增减数组，图片用独立的 `qr_image_format: "PNG" | "SVG"` 生成 Graph formatted field；列表还支持 `code`、1–25 的 `limit` 与 `after` cursor。创建图片使用 `generate_qr_image`，适配器会校验 14 位大写字母数字 code、140 字符预填消息、分页结构以及单项响应的单元素 `data` 数组。

消息模板通过 `client.messageTemplates` 管理，并提供列表、按 ID 查询、namespace、创建、编辑、按名称删除全部语言和按 ID 删除单一模板的固定动作。查询 `fields` 使用受限数组；模板顶层字段闭合，名称、locale、category、状态和分页响应均会校验。组件必须包含 `type`，其余 OTP、Flow、Catalog、MPM、媒体 handle 等平台字段使用递归可序列化 JSON 扩展面，循环引用、危险键、非有限数字和不可序列化值会在请求前被拒绝。

用户封禁通过 `client.blockedUsers` 管理。`block_users` / `unblock_users` 接受去重后的 E.164 数组并保留 Meta 返回的输入号码到规范化 `wa_id` 映射；`list_blocked_users` 返回经过校验的用户与分页游标。单数动作不再存在，避免隐藏平台原生的批处理语义。

对话自动化通过 `client.automation` 管理。`configure_conversational_automation` 可启停欢迎消息、配置最多 3 个 80 字符引导问题，以及最多 30 个唯一 Bot 命令；空数组会明确清空对应配置。`get_business_bot` 按独立 WABA Bot ID 和受控字段数组读取配置，不能用 Phone Number ID 冒充 Bot ID。命令名、描述、字段选择和响应均在边界校验。

Groups API 提供 `create_group`、`get_group`、`list_groups`、`update_group`、`delete_group`、`create_group_invite_link`、`delete_group_invite_link`、入群申请审批、参与者增删以及 `pin_message` / `unpin_message` 等固定动作。标准 `send_message`、群资料、群成员、改名、邀请/移除成员和 `handle_group_request` 也复用同一实现。该能力仅适用于当前 Phone Number 通过 Groups API 创建和管理的群，并要求 Meta 为 Official Business Account 开通资格；它不表示适配器能访问普通消费者群组。

Calling API 提供 `get_call_permissions`、`request_call_permission`、`connect_call`、`pre_accept_call`、`accept_call`、`reject_call` 与 `terminate_call` 固定动作，也可直接使用 `client.calling` 获得完整类型。呼叫权限申请通过原生 `interactive.call_permission_request` 消息发送；`connect` 使用 offer SDP，`accept` 使用 answer SDP，`terminate` 使用 Meta 返回的 `call_id`。此模块只负责权限和呼叫信令，不会伪装成 WebRTC/SIP 媒体实现；媒体会话、ICE 与音频传输由调用方负责。当前 Phone Number 必须先获准启用 Cloud API Calling。

消息历史通过 `list_message_history` 与 `list_message_history_events` 固定动作提供，也可使用 `client.history.list/listAll/listEvents/listAllEvents`。它保留投递状态、Webhook 更新状态、时间戳、应用与错误说明，并校验每一页的官方响应结构；完整遍历检测到重复 cursor 时会失败，不会返回看似成功的不完整列表。此能力是投递状态诊断接口，不是聊天内容归档或任意历史消息读取。

号码设置使用 `get_phone_number_settings`、`update_calling_settings`、`update_user_identity_change_settings`、`update_payload_encryption_settings` 与 `update_storage_configuration_settings`，或直接使用强类型 `client.settings`。Meta 要求一次请求只能更新一个 feature，适配器为此提供独立方法并只发送对应字段；启用 payload encryption 时必须提供客户端公钥，关闭时不会携带密钥。读取 SIP 密码必须显式设置 `include_sip_credentials` 且由 Meta 权限控制，请避免记录该响应。

加密消息使用 `send_encrypted_message` 或 `client.encryptedMessages.send(compactJwe)`。适配器只向 `messages_encrypted` 发送官方允许的两个字段，并校验请求和成功响应均为五段 compact JWE；明文加密、响应解密、私钥保护和轮换由业务负责。Meta 的失败响应仍是未加密的结构化 Graph API 错误。

号码生命周期由 `client.phoneNumbers` 管理，并提供 `get_phone_number_info`、`register_phone_number`、`deregister_phone_number`、`set_two_step_verification`、`request_phone_number_verification_code` 与 `verify_phone_number_code` 固定动作。注册支持官方迁移 `backup`；验证码方式仅接受 `SMS` / `VOICE` 和 `en_US` 形式的 locale。适配器不发送 v21 起弃用的数据驻留注册字段，注销也不会夹带规范外请求体。PIN、验证码与迁移 backup 都是敏感信息，请勿记录。

Flow/data-channel 的 Business Encryption 与消息 payload encryption 是不同控制面。使用 `get_business_encryption_key` / `set_business_encryption_key` 或 `client.businessEncryption` 管理：上传必须是能被 Node crypto 解析的至少 2048 位 RSA PEM 公钥，并使用 Meta 要求的 multipart 字段；读取返回 `VALID` / `MISMATCH` 签名状态。适配器永远不接收或保存私钥。

Business Profile 使用 `client.businessProfile` 或原有 `get_business_profile` / `update_business_profile` 动作。读取字段必须以数组显式增减，更新只接受 Meta 的 about、address、description、email、websites、vertical 和 `profile_picture_handle`，并校验长度、URL、邮箱与行业枚举；任意额外 JSON 字段会被拒绝。头像需先通过 Resumable Upload API 获得 handle，不能直接把图片 URL 当作 handle。

Business Compliance 使用 `client.businessCompliance` 或 `get_business_compliance_info` / `update_business_compliance_info`。读取字段同样使用可增减数组；写入会校验官方实体类型、法定名称、联系人邮箱与 E.164 电话，并执行 `OTHER` / `entity_type_custom` 及 `is_registered` 的跨字段约束。平台动作把完整写入对象放在 `info` 字段中，未知字段会被拒绝。

Multi-Partner Solution 迁移使用 `client.solutionMigration` 或 `get_migration_intent` / `set_solution_migration_intent`。查询只接受官方 `id` / `status` 字段数组；设置动作的完整载荷放在 `request` 中，并校验 solution ID、迁移意图枚举、原因长度与 ISO 8601 调度时间。读取和设置使用不同的官方状态枚举，不会混为一类。

## 参考

- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/)
- [Meta 官方 Postman 集合](https://www.postman.com/meta/whatsapp-business-platform/overview/)
