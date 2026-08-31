# @onebots/adapter-facebook-messenger

Facebook Messenger Platform / Graph API adapter for OneBots. The implementation targets the current stable Graph v25.0 surface and does not open a listener port.

## 特性

- 可嵌入 `FacebookMessengerClient`，支持已有 Fetch/Koa Host 的 `acceptHttp()` / `ingestHttp()` 与最底层 `ingest(rawEvent)`；
- 精确原始字节 `X-Hub-Signature-256` 校验、batch 展开、可靠去重和严格外部 JSON 校验；
- Send API、sender actions、附件上传、Conversations/history、Page/User Profile；
- Messenger Profile、Page subscription、conversation moderation 与 Handover Protocol；
- Utility Messaging 模板库、创建、查询和 `UTILITY` 类型发送；
- 文本、回复、媒体、quick replies 和任意官方原生 Messenger message body；
- 配置的 webhook fields、事件和已声明权限会动态收敛账号能力。

## Standalone client

```ts
import { FacebookMessengerClient } from "@onebots/adapter-facebook-messenger";

const client = new FacebookMessengerClient({
  account_id: "support-page",
  page_id: "1234567890",
  page_access_token: process.env.META_PAGE_ACCESS_TOKEN!,
  receive_mode: "manual",
});

client.on("event", async delivery => {
  await dispatch(delivery);
});

await client.start();
await client.ingest(rawMetaWebhookEnvelope);
```

Webhook 模式必须把宿主收到的精确 raw body 交给 Client，不能先解析再 `JSON.stringify()`。业务监听器全部成功后才会确认 delivery，Meta 重试仍可恢复失败事件。

## English

The typed client shares one Graph transport and reliable webhook pipeline with the OneBots adapter. Existing hosts can pass a Fetch `Request` to `acceptHttp()`, use structured `ingestHttp()` with exact raw bytes, or pass an already decoded envelope to `ingest()`. See the [Chinese platform guide](../../docs/src/platform/facebook-messenger.md) or [English platform guide](../../docs/src/en/platform/facebook-messenger.md).
