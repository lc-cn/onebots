# WhatsApp 平台

WhatsApp 适配器使用 Meta 官方 Cloud API。事件通过安全 Webhook 进入 OneBots；出站消息直接调用版本化 Graph API。

## 平台能力

- 私聊与 Groups API 群消息：文本、回复、图片、视频、音频、文档、Sticker、位置、联系人和 Reaction
- 原生消息：Template、Interactive、Flow 以及 Cloud API 后续新增类型
- 消息状态：`sent`、`delivered`、`read`、`failed`、`deleted`
- 媒体：上传、查询临时 URL、鉴权下载和删除
- 管理：Business Profile、Commerce、Flow 生命周期、号码注册/注销、两步验证、用户屏蔽、消息模板
- 群管理：群资料/成员、改名、参与者增删、邀请链接、入群申请审批，以及生命周期/设置/冻结 Webhook
- 呼叫控制：用户权限查询/申请、建立、预接受、接受、拒绝与终止；SDP/WebRTC 媒体平面由调用方负责
- 投递诊断：按 WAMID 查询消息状态、Webhook 更新结果与分页事件时间线
- 号码设置：Calling/SIP/视频、身份变化通知、payload encryption 公钥和数据驻留
- 加密消息：Payload Encryption 固定端点、compact JWE 请求与加密响应校验
- 号码生命周期：资料状态、注册/注销、两步验证、短信或语音验证码申请与校验
- Business Encryption：Flow/data-channel RSA 公钥上传、读取和 `VALID` / `MISMATCH` 状态
- Business Profile：强类型资料、可选读取字段、受控更新和头像 upload handle
- 原始事件：所有 Webhook change 均保留在 `raw_event`
- 嵌入式接入：`await WhatsAppClient.ingest(rawEvent)` 可把已有可信连接交给同一 Client；同步/异步监听器全部成功后才确认去重

Groups API 仅适用于符合 Meta 资格要求的 Official Business Account，以及当前 Phone Number 通过该 API 创建和管理的群；它不能访问普通消费者群组。Cloud API 也不提供好友列表或任意历史消息查询，因此适配器不会伪造这些能力。

## 安装与配置

```bash
pnpm add @onebots/adapter-whatsapp
```

```yaml
whatsapp.my_bot:
  phone_number_id: "your_phone_number_id"
  business_account_id: "your_business_account_id"
  access_token: "your_long_lived_access_token"
  app_secret: "your_meta_app_secret"
  webhook_verify_token: "your_random_verify_token"
  api_version: "v23.0"
```

完整字段见 [配置页](/config/adapter/whatsapp)。

## 原生消息

标准消息段无法表达的 Template、Interactive 或 Flow，可以使用 `whatsapp_message`：

```ts
const message = [{
  type: "whatsapp_message",
  data: {
    message: {
      type: "template",
      template: {
        name: "hello_world",
        language: { code: "en_US" },
      },
    },
  },
}];
```

## 平台动作

常用动作包括 `send_native_message`、`mark_message_read`、`upload_media`、`download_media`、Business Profile、Commerce、Flow 生命周期、`block_user` 和消息模板管理。Groups API 另有 `create_group`、`get_group`、`list_groups`、`update_group`、`delete_group`、`create_group_invite_link`、`delete_group_invite_link`、入群申请审批、参与者增删以及 `pin_message` / `unpin_message`。`get_supported_actions` 会返回当前完整清单及资格要求。

Calling API 使用 `get_call_permissions` / `request_call_permission` 与 `connect_call`、`pre_accept_call`、`accept_call`、`reject_call`、`terminate_call`。适配器严格区分 offer、answer 和 `call_id`，但不负责 WebRTC/SIP 媒体传输。调用前需要 Meta 为当前 Phone Number 开通 Cloud API Calling，并具备 `whatsapp_business_messaging` 权限。

消息历史使用 `list_message_history` 与 `list_message_history_events`，用于诊断投递状态、Webhook 更新状态和失败原因。`client.history` 还提供沿 cursor 完整遍历的强类型入口；该 API 不包含聊天正文，不能当作聊天记录归档。

号码级设置通过 `client.settings` 及对应固定平台动作管理。Calling、身份变化、payload encryption 和数据驻留每次只更新一个 feature，避免违反 Meta 请求约束；读取 SIP 凭据必须显式启用并谨慎处理返回的密码。

启用 payload encryption 后，可通过 `send_encrypted_message` 或 `client.encryptedMessages.send(compactJwe)` 使用专用加密消息端点。适配器不会接触明文和私钥，只负责 compact JWE 结构、固定请求字段与加密成功响应；密钥保护、轮换和解密由业务实现，失败响应仍按结构化 Graph API 错误处理。

号码注册、注销、两步验证和所有权验证码统一由 `client.phoneNumbers` 与对应固定平台动作提供。迁移注册可携带完整 `backup`，短信/语音验证码会校验方式、locale 和六位数字；已弃用的数据驻留注册字段不会继续暴露。PIN、验证码和迁移备份均应按敏感信息处理。

Flow/data-channel Business Encryption 使用 `client.businessEncryption` 或 `get_business_encryption_key` / `set_business_encryption_key`。它独立于消息 payload encryption：上传端会解析 PEM、确认 RSA 类型和至少 2048 位强度，再以 multipart 提交；读取端保留 Meta 的公钥签名状态。私钥始终由业务保管，不应交给适配器。

Business Profile 通过 `client.businessProfile` 与同名固定平台动作管理。读取字段使用可增减数组，更新只发送官方字段并校验长度、邮箱、HTTP(S) 网站和 vertical 枚举；头像字段使用 Resumable Upload API 产生的 `profile_picture_handle`。未知字段不会透传到 Meta。

Commerce 设置由 `client.commerce` 或 `get_commerce_settings` / `update_commerce_settings` 管理。读取会校验官方 `data` 数组；更新只接受 `is_cart_enabled` 与 `is_catalog_visible` 布尔字段，至少设置一项，并拒绝未知字段。

消息二维码由 `client.qrCodes` 及五个固定 QR Code 动作管理。查询字段使用数组动态增减，PNG/SVG 图片格式独立选择；列表支持 code 过滤、1–25 条分页和 cursor。创建、更新、单项查询与删除均校验 Meta v23 的精确响应结构，错误 code、超长预填消息和任意附加参数不会透传。

消息模板由 `client.messageTemplates` 管理，固定动作覆盖列表、按 ID 读取、namespace、创建、编辑，以及按名称或模板 ID 删除。查询字段使用受限数组，模板顶层契约与响应结构强校验；组件保留 OTP、Flow、Catalog、MPM 和媒体 handle 等 Meta 扩展字段，但只接受安全、可递归序列化的 JSON。

Business Compliance 通过 `client.businessCompliance` 以及 `get_business_compliance_info` / `update_business_compliance_info` 管理。读取字段是可增减数组；写入严格验证实体类型、法定名称、联系人邮箱与 E.164 电话，并落实 `OTHER` 自定义类型和 `is_registered` 的官方跨字段规则。平台动作的更新对象使用 `info` 字段，额外字段不会透传。

Multi-Partner Solution 迁移由 `client.solutionMigration` 与 `get_migration_intent` / `set_solution_migration_intent` 提供。查询字段固定为官方 `id` / `status` 集合；设置请求放在 `request` 中，校验纯数字 solution ID、迁移意图枚举、500 字符原因和 ISO 8601 时间。适配器区分迁移实体状态与请求处理状态，避免错误类型推断。

新 Graph API 可通过 `whatsapp_call` 调用：

```ts
await adapter.callAction("my_bot", "whatsapp_call", {
  method: "GET",
  resource: "your-waba-id/message_templates",
  query: { limit: 50 },
});
```

`resource` 必须是相对路径，避免 Access Token 越权发送。需要管理权限的动作会在能力清单中标明 `whatsapp_business_management` 或 `whatsapp_business_messaging`。

## 使用限制

- 电话号码使用带国家代码的纯数字格式。
- 业务主动发起且超出客户服务窗口的消息通常需要已审核模板。
- API 版本由 Meta 生命周期管理，`api_version` 必须按应用实际启用版本明确配置。
- Groups API 需要 Meta 开通 Official Business Account 资格，并订阅 v23 定义的 `group_lifecycle_update`、`group_participant_update`、`group_settings_update` Webhook 字段。

参考：[WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/)、[Meta 官方 Postman 集合](https://www.postman.com/meta/whatsapp-business-platform/overview/)。
