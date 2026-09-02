# @onebots/adapter-instagram

Instagram Messaging adapter for OneBots, based on the current Instagram API with Instagram Login and Graph v25.0. It uses `graph.instagram.com`, does not require a Facebook Page, and never opens its own listener port.

## 特性

- 可嵌入 `InstagramClient`，支持已有 Fetch/Koa Host 的 `acceptHttp()` / `ingestHttp()` 与最底层 `ingest(rawEvent)`；
- 精确 raw-body `X-Hub-Signature-256` 校验、batch 展开、可靠去重与严格外部 JSON 校验；
- Send API、附件上传、Conversations、消息详情与 IGSID User Profile；
- quick replies、generic/button 原生消息、like-heart、published post media share 与 reaction；
- Messenger Profile、Professional Account webhook subscription 与 Welcome Message Flows；
- comment private reply 与显式 Human Agent 动作，并保留官方时间窗和用途限制；
- 配置的 webhook fields、事件和已声明权限会动态收敛账号能力。

## Standalone client

```ts
import { InstagramClient } from "@onebots/adapter-instagram";

const client = new InstagramClient({
  account_id: "support",
  instagram_user_id: "1234567890",
  access_token: process.env.INSTAGRAM_ACCESS_TOKEN!,
  receive_mode: "manual",
});

client.on("event", delivery => dispatch(delivery));
await client.start();
await client.ingest(rawInstagramWebhookEnvelope);
```

Webhook 模式必须把宿主收到的精确原始字节交给 Client，不能先解析再序列化。Human Agent 只允许 7 天内由真实人工客服发送；适配器不会把它设为普通消息默认行为。

## English

The typed client shares one Graph transport and reliable webhook pipeline with the OneBots adapter. Existing hosts can pass a Fetch `Request` to `acceptHttp()`, use structured `ingestHttp()` with exact raw bytes, or pass a decoded envelope to `ingest()`. See the [Chinese platform guide](../../docs/src/platform/instagram.md) or [English platform guide](../../docs/src/en/platform/instagram.md).
