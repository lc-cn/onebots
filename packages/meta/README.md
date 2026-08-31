# @onebots/meta

Facebook Messenger 与 Instagram Messaging 适配器共用的 Meta Graph API / Webhook 基础层。

- `MetaGraphTransport` 固定版本化 Graph 路径，使用 Bearer token，可选 `appsecret_proof`，保留结构化 Graph 错误与用量响应头；
- `MetaWebhookClient` 支持已有 Host 的 `acceptHttp(Request)` / `ingestHttp()` 与最底层 `ingest(rawEvent)`；
- POST 必须使用签名覆盖的精确原始字节校验 `X-Hub-Signature-256`，不会重新序列化 JSON 冒充 raw body；
- 业务监听器全部成功后才提交事件身份，Meta 重试不会丢事件；
- 不自行监听端口，也不跟随 Graph `paging.next` 中的不受信 URL。

## English

Shared Meta Graph API and webhook foundation for the Facebook Messenger and Instagram Messaging adapters. It keeps tokens out of URLs, validates exact signed bytes, exposes structured errors and usage metadata, and commits webhook deduplication only after downstream listeners succeed. It never opens its own port.
