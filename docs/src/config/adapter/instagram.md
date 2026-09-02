# Instagram Messaging 配置

安装并加载适配器：

```bash
pnpm add @onebots/adapter-instagram
onebots -r instagram
```

本适配器只采用当前 Instagram Login 模型。创建 Meta App，启用 Business Login for Instagram，并申请当前权限 `instagram_business_basic` 与 `instagram_business_manage_messages`。不要填写 2025 年已弃用的 `business_*` 旧 scope，也不需要 Facebook Page Access Token。

```yaml
instagram.support:
  instagram_user_id: "1234567890"
  access_token: ${INSTAGRAM_ACCESS_TOKEN}
  app_secret: ${META_APP_SECRET}
  verify_token: ${META_WEBHOOK_VERIFY_TOKEN}
  receive_mode: webhook
  http_path: /instagram/support/events
  auto_subscribe: true
  subscribed_fields:
    - messages
    - messaging_postbacks
    - messaging_seen
    - message_reactions
  event_types:
    - message
    - message_echo
    - message_edit
    - read
    - reaction
    - postback
  declared_permissions:
    - instagram_business_basic
    - instagram_business_manage_messages
```

`account_id` 来自配置键后缀，`instagram_user_id` 是 Professional Account 的十进制 Meta ID，不是 username。Web 表单按凭据、接收、过滤和高级项分区；webhook fields、事件与权限均可动态增减，无需手写 JSON。

## Webhook

把 Meta App Dashboard 的 Callback URL 指向公开 HTTPS origin 加 `http_path`，Verify Token 必须完全一致。OneBots 复用主 Host。宿主必须保留请求原始字节；先解析再 `JSON.stringify()` 会破坏签名语义。

`auto_subscribe` 调用 `/{instagram-user-id}/subscribed_apps`。若订阅由部署系统管理，可关闭它，但仍应让 `subscribed_fields` 与上游真实设置一致，Web 能力面板才会准确显示可达事件。

## Manual / 已有 Host

```ts
import { InstagramClient } from "@onebots/adapter-instagram";

const client = new InstagramClient({
  account_id: "embedded",
  instagram_user_id: "1234567890",
  access_token,
  receive_mode: "manual",
});

client.on("event", delivery => dispatch(delivery));
await client.start();
await client.ingest(rawEnvelope);
```

Webhook 模式还可调用 `acceptHttp(Request)` 或 `ingestHttp({ method, url, headers, rawBody })`。Manual 模式只接受 `ingest()`，避免在没有签名身份时误收 HTTP。

## 权限与安全边界

- 用户资料要求用户先发送消息、点击 Ice Breaker 或 Persistent Menu；
- 评论 private reply 还需要 `instagram_business_manage_comments`；
- Human Agent 是单独审核的功能，只有真实人工支持场景才可调用；
- token 只放在 Bearer header，存在 App Secret 时追加 `appsecret_proof`；
- Graph 路径拒绝绝对 URL、authority、查询串和路径穿越；
- 媒体 URL 只接受无凭据 HTTPS，本地路径不会由网关读取；
- 所有外部响应和 webhook payload 都执行运行时校验。

官方参考：[Instagram API](https://www.postman.com/meta/instagram/overview)。
