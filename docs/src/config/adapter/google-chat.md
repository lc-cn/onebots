# Google Chat 配置

安装并在 OneBots 启动参数中加载：

```bash
pnpm add @onebots/adapter-google-chat
onebots -r google-chat
```

Web 配置页会直接生成分区表单：身份和接收方式使用选择器，OAuth scopes 与事件类型使用可动态增减的选择列表，私钥/token 标记为敏感字段；不需要手填 JSON。

## API 身份

### Service Account（应用身份）

适合 Chat app。启用 Google Chat API，为 Chat app 绑定 service account，并配置：

```yaml
google-chat.chat_app:
  auth_mode: service-account
  service_account_email: bot@project.iam.gserviceaccount.com
  service_account_private_key: |
    -----BEGIN PRIVATE KEY-----
    ...
    -----END PRIVATE KEY-----
  principal_name: users/app
```

未填写 `oauth_scopes` 时使用 `chat.bot`。读取全部消息、管理 Space 或 membership 的应用身份 scope 可能需要 Workspace 管理员批准；Web 能力面板会把这些动作标成权限依赖，不会声称无条件可用。

应用自行退出 Space 需要 `chat.memberships.app`。用户身份若要调用 canonical `leave_group`，请把 `principal_name` 配置为 `users/{id|email}`；`users/me` 可用于多数用户 API，但不能唯一匹配 membership resource。

### 已有 Access Token（用户身份）

适合由现有 OAuth 服务维护 token 的嵌入场景：

```yaml
google-chat.user:
  auth_mode: access-token
  access_token: ${GOOGLE_CHAT_ACCESS_TOKEN}
  principal_name: users/me
  oauth_scopes:
    - https://www.googleapis.com/auth/chat.messages
    - https://www.googleapis.com/auth/chat.spaces
    - https://www.googleapis.com/auth/chat.memberships
```

静态 access token 的刷新由提供它的系统负责，适配器不会猜测 refresh token 流程。

## Interaction HTTPS

```yaml
google-chat.chat_app:
  receive_mode: interaction-http
  http_path: /google-chat/chat_app/events
  verification_mode: endpoint-url
  verification_audience: https://bots.example.com/google-chat/chat_app/events
```

Google Cloud Chat API Configuration 的 HTTP endpoint 指向同一公开 HTTPS URL。`endpoint-url` 验证 Google Chat OIDC ID token，audience 必须是完整 endpoint URL；若 Cloud 项目仍使用 project number 自签 JWT，选择 `project-number` 并将 audience 填为项目号。OneBots 复用主 HTTP Host，不另开端口；账号热重载时路由动态取得当前 Client。

## Workspace Events + Pub/Sub push

```yaml
google-chat.audit:
  receive_mode: pubsub-push
  http_path: /google-chat/audit/events
  verification_audience: https://bots.example.com/google-chat/audit/events
  pubsub_service_account_email: push-auth@project.iam.gserviceaccount.com
  event_types:
    - google.workspace.chat.message.v1.created
    - google.workspace.chat.message.v1.updated
    - google.workspace.chat.reaction.v1.created
```

为 Pub/Sub push subscription 启用 authenticated push，并让指定 service account 生成 OIDC token。适配器同时验证 audience、`email_verified` 和精确 email。Google 自动产生的 `batchCreated`/`batchUpdated`/`batchDeleted` 会被严格展开；下游监听器失败时返回非 2xx，让 Pub/Sub 重投。

## Manual / 已有 Host

```ts
import { GoogleChatClient } from "@onebots/adapter-google-chat";

const client = new GoogleChatClient({
  account_id: "embedded",
  auth_mode: "access-token",
  access_token,
  receive_mode: "manual",
  principal_name: "users/me",
});

client.on("event", event => dispatch(event));
await client.start();
await client.ingest(rawInteractionOrCloudEvent);
```

需要复用已有 Fetch Host 时，HTTP 模式可调用 `acceptHttp(Request)`；框架 Host 可调用结构化 `ingestHttp({ method, url, headers, body })`。`manual` 本身只接受 `ingest()`，避免未配置身份校验却误收 HTTP。

## 安全边界

- `call()` 只接受相对 API pathname，拒绝绝对 URL、authority、查询串和路径穿越；
- `upload_file` 只接受宿主已读取的 base64，不读取本机路径或抓取 URL；
- `downloadMedia(resourceName)` 返回 `Uint8Array`，不会把二进制内容混进 JSON `call()`；
- Interaction/Pub/Sub 只在 token、事件结构和全部异步监听器均成功后 ACK；
- `event_types` 是封闭的当前稳定事件选择，不把未知或预览事件静默当成稳定事件。

官方参考：[REST v1](https://developers.google.com/workspace/chat/api/reference/rest)、[Interaction 验证](https://developers.google.com/workspace/chat/verify-requests-from-chat)、[Chat event subscriptions](https://developers.google.com/workspace/events/guides/events-chat)。
