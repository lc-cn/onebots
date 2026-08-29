# @onebots/adapter-whatsapp

基于 Meta 官方 WhatsApp Cloud API 的 OneBots 适配器。它复用 OneBots HTTP Host 接收 Webhook，不会自行监听额外端口。

## 能力

- 发送和接收文本、回复、图片、视频、音频、文档、Sticker、位置、联系人、Reaction
- 通过 `whatsapp_message` 原生段发送 Template、Interactive、Flow 等完整 Cloud API 消息
- 展开同一 Webhook 批次中的全部消息和状态，未知 change 也作为原始事件交付
- 使用原始请求体校验 `X-Hub-Signature-256`，并过滤 Meta 重投递
- 媒体上传、查询、下载、删除，消息已读与 typing indicator
- Business Profile、号码注册、两步验证、用户屏蔽和消息模板管理
- 通用 `whatsapp_call`，无需等待适配器升级即可调用新的 Graph API 资源
- `WhatsAppClient.ingest(rawEvent)`，让外部可信连接复用同一事件分发链路

通用 `image`、`video`、`audio`、`file`、`sticker` 段可直接使用 `media_id` 或公开 HTTPS URL；本地路径、HTTP URL、data URL 与 `base64://` 会先上传到当前 Phone Number，再用真实 media ID 发送。`template` 与 `interactive` 可直接作为结构化消息段发送，也可使用 `whatsapp_message` 承载任意原生负载。一条通用消息拆成多个 Cloud API 请求时，所有请求都会保留同一个 `reply` 上下文。

## 配置

```yaml
whatsapp.my_bot:
  phone_number_id: "your_phone_number_id"
  business_account_id: "your_business_account_id"
  access_token: "your_long_lived_access_token"
  app_secret: "your_meta_app_secret"
  webhook_verify_token: "your_random_verify_token"
  api_version: "v23.0"

  onebot.v11:
    access_token: "your_onebots_token"
```

默认回调路径是 `/whatsapp/my_bot/webhook`。将完整公网地址和同一个 `webhook_verify_token` 填入 Meta App Dashboard，并订阅 `messages` 字段。Koa 请求解析器必须保留未经修改的 `rawBody`，否则适配器会拒绝无法验签的请求。

配置只使用上面的 snake_case 字段；旧的 camelCase、`webhook.url`、`webhook.fields` 和适配器私有代理配置不再使用。

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

## 参考

- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/)
- [Meta 官方 Postman 集合](https://www.postman.com/meta/whatsapp-business-platform/overview/)
