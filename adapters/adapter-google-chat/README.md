# @onebots/adapter-google-chat

Google Chat REST v1, Chat interaction HTTPS, and Google Workspace Events adapter for OneBots.

实现基线为当前官方稳定 Google Chat REST v1 与 Workspace Events API；开发者预览能力不会被声明为稳定能力。

## 特性

- 可嵌入 `GoogleChatClient`，支持 `interaction-http`、`pubsub-push`、`manual`；
- `ingest(rawEvent)`、结构化 `ingestHttp()` 与 Fetch `acceptHttp(Request)` 共用可靠去重管线；
- 验证 Google Chat OIDC/self-signed JWT 与 Pub/Sub push OIDC 身份，失败不会 ACK；
- 自动展开 Workspace batch event，严格解析外部 JSON 和 resource name；
- 消息、编辑、删除、历史、Space、成员、reaction、附件、read state 与 availability 原生动作；
- `call(method, relativePath, options)` 覆盖当前稳定 REST v1，拒绝绝对 URL 与路径穿越；
- `downloadMedia(resourceName)` 以 `Uint8Array` 下载上传附件，不把二进制伪装成 JSON；
- Interaction 入口可通过 `interactionResponse` 返回文本、卡片或 dialog 结构化响应。

## Standalone client

```ts
import { GoogleChatClient } from "@onebots/adapter-google-chat";

const client = new GoogleChatClient({
  account_id: "chat-app",
  auth_mode: "access-token",
  access_token: process.env.GOOGLE_CHAT_ACCESS_TOKEN,
  receive_mode: "manual",
  principal_name: "users/me",
});

client.on("event", async envelope => {
  await handleGoogleChatEvent(envelope);
});

await client.start();
await client.ingest(rawInteractionOrCloudEvent);

const attachment = await client.downloadMedia("spaces/AAA/attachments/file-id");
```

## English

The fully typed client never opens its own port. Existing Koa/Fetch hosts and Pub/Sub receivers can pass authenticated requests to `ingestHttp()` or `acceptHttp()`, while an existing connection can use `ingest()`. Delivery is committed only after every asynchronous listener succeeds, so upstream retries remain safe.

See the [Chinese platform guide](../../docs/src/platform/google-chat.md) or [English platform guide](../../docs/src/en/platform/google-chat.md).
