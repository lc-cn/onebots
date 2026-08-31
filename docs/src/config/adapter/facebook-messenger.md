# Facebook Messenger 配置

安装并加载适配器：

```bash
pnpm add @onebots/adapter-facebook-messenger
onebots -r facebook-messenger
```

Web 配置页按凭据、接收、过滤、发送和高级选项分区。Webhook fields、canonical 事件和 permissions 都是可动态增减的选择列表，无需手写 JSON；敏感令牌不会作为普通文本展示。

## 准备 Meta 应用

在 Meta App 中添加 Messenger 产品，为目标 Facebook Page 获取 Page Access Token，并按实际能力授予 `pages_messaging`、`pages_manage_metadata`、`pages_read_engagement`。Utility Messaging 另需 `page_utility_messaging`。

```yaml
facebook-messenger.support:
  page_id: "1234567890"
  page_access_token: ${META_PAGE_ACCESS_TOKEN}
  app_secret: ${META_APP_SECRET}
  verify_token: ${META_WEBHOOK_VERIFY_TOKEN}
  receive_mode: webhook
  http_path: /facebook-messenger/support/events
  auto_subscribe: true
  subscribed_fields:
    - messages
    - message_deliveries
    - message_reads
    - message_reactions
    - messaging_postbacks
  event_types:
    - message
    - delivery
    - read
    - reaction
    - postback
  declared_permissions:
    - pages_messaging
    - pages_manage_metadata
    - pages_read_engagement
```

`account_id` 是 OneBots 配置键后缀；`page_id` 和 PSID 必须是真实十进制 Meta ID。`declared_permissions` 只用于精确展示当前账号能力，不会代替 Meta 授权。

## Webhook

把 Meta App Dashboard 的 Callback URL 指向公开 HTTPS 域名加 `http_path`，Verify Token 必须与配置完全一致。OneBots 复用主 HTTP Host，不另开端口。宿主必须保留原始请求字节；先解析 JSON 再序列化会破坏签名语义。

`auto_subscribe` 会在启动时调用 `/{page-id}/subscribed_apps`。若订阅由部署系统管理，可关闭它，但仍应在 `subscribed_fields` 中准确声明上游实际启用的字段，以便 Web 能力面板反映真实事件范围。

## Manual / 已有 Host

```ts
import { FacebookMessengerClient } from "@onebots/adapter-facebook-messenger";

const client = new FacebookMessengerClient({
  account_id: "embedded",
  page_id: "1234567890",
  page_access_token,
  receive_mode: "manual",
});

client.on("event", delivery => dispatch(delivery));
await client.start();
await client.ingest(rawEnvelope);
```

Webhook 模式还可把已有 Fetch `Request` 传给 `acceptHttp()`，或调用结构化 `ingestHttp({ method, url, headers, rawBody })`。`manual` 只接受 `ingest()`，避免在未配置签名身份时误收 HTTP。

## 安全边界

- Graph token 只放在 Bearer header，`app_secret` 存在时附带 `appsecret_proof`；
- `call()` 拒绝绝对 URL、authority、查询串和路径穿越；
- URL 媒体只接受无凭据 HTTPS，本地路径不会由网关读取；
- Graph/Webhook 响应执行运行时校验，畸形外部数据不会以类型断言混入系统；
- 下游处理失败不会提交去重，Meta 重试仍可重新投递。

官方参考：[Messenger Platform API](https://www.postman.com/meta/messenger-platform-api/overview)、[Graph API](https://developers.facebook.com/docs/graph-api/)。
