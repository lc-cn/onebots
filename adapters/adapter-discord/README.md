# @onebots/adapter-discord

OneBots 的 Discord 官方 Bot 适配器。实现直接面向 Discord API v10，不依赖 `discord.js`，同时提供可独立使用的强类型 Lite 客户端。

## 能力概览

- Gateway WebSocket：无限重连、Resume、心跳 ACK 检测、Identify 限速、分片、Presence、AbortSignal。
- Interactions Webhook：Ed25519 验签、重放时间窗、应用命令、组件、Modal、自动补全。
- REST：Discord route/global rate limit、429 自动重试、AbortSignal、审计日志原因、附件上传和结构化错误。
- 事件：消息编辑/删除与批量删除、Reaction、Guild 成员、Interaction；未知 Dispatch 仍通过 `raw_event` 无损交付。
- 消息：文本、用户/角色/频道提及、回复、Embed、Sticker 与多媒体附件。
- 平台扩展：公开常用 Guild、频道、角色、线程、邀请和 Reaction 动作，并保留受约束的完整 Discord v10 REST 入口。

`ws` 作为适配器的可选依赖随包解析；HTTP(S) 与 SOCKS Agent 由 OneBots 共享代理层统一提供，不使用时不会加载。适配器不会引入 `discord.js`。

## 安装

```bash
pnpm add @onebots/adapter-discord
```

## OneBots 配置

### Gateway 模式

```yaml
discord.my_bot:
  token: "your_discord_bot_token"
  receive_mode: gateway
  proxy:
    url: "socks5://127.0.0.1:7890"
  intents:
    - Guilds
    - GuildMembers
    - GuildMessages
    - GuildMessageReactions
    - DirectMessages
    - DirectMessageReactions
    - MessageContent
  shard:
    id: 0
    total: 2
  presence:
    status: online
    activities:
      - name: "正在运行 OneBots"
        type: 0
```

Web 管理端会将 Intents 渲染为受约束的选择列表，将 Presence activities 渲染为可动态增减的表单；分片、凭据和网络项按语义分区展示，无需手写数组 JSON。特权 Intent 仍须先在 Discord Developer Portal 开启。

### Interactions 模式

```yaml
discord.my_bot:
  token: "your_discord_bot_token"
  receive_mode: interactions
  application_id: "123456789012345678"
  public_key: "64位十六进制Application Public Key"
```

将 Developer Portal 的 Interactions Endpoint URL 指向：

```text
https://你的网关/discord/my_bot/interactions
```

该模式复用 OneBots 已有 HTTP Host，不创建独立端口。请求必须保留未经修改的 `rawBody`，否则适配器会拒绝无法验签的载荷。适配器会在 Discord 的 3 秒窗口内返回 deferred 确认，再把 Interaction 分发给已配置协议；下游可从 `raw_event` 取得 Interaction token 并通过 Discord Webhook API 编辑原始回复。Gateway 适合完整消息和 Guild 事件；Interactions 模式只接收 Discord 的应用交互。

### 手动接入模式

```yaml
discord.my_bot:
  token: "your_discord_bot_token"
  receive_mode: manual
```

`manual` 不注册 Gateway 或 HTTP 路由。已有 Host 完成 Discord 验签后，将原始 Interaction 交给 `account.client.ingestInteraction(rawInteraction)`；此入口不会再次验签。若要由适配器完成 HTTP 验签，应使用 `interactions` 模式或直接构造带 Public Key 的 `InteractionsHandler`。

## 独立使用 Lite SDK

### Gateway

```typescript
import { DiscordLite, GatewayIntents } from "@onebots/adapter-discord/lite";

const client = new DiscordLite({
  token: process.env.DISCORD_TOKEN!,
  mode: "gateway",
  intents: GatewayIntents.Guilds | GatewayIntents.GuildMessages | GatewayIntents.MessageContent,
});

client.on("client_error", error => logger.error(error));
client.on("messageCreate", message => {
  if (message.content === "!ping") void client.sendMessage(message.channel_id, "Pong!");
});

const abort = new AbortController();
await client.start(abort.signal);
// abort.abort() 会停止 Gateway 及后续重连。
```

### Interactions 与已有 HTTP Host

```typescript
import { InteractionsHandler } from "@onebots/adapter-discord/lite";

const interactions = new InteractionsHandler({
  publicKey: process.env.DISCORD_PUBLIC_KEY!,
  token: process.env.DISCORD_TOKEN!,
  applicationId: process.env.DISCORD_APP_ID!,
});

interactions.onCommand("ping", () => InteractionsHandler.messageResponse("Pong!"));
interactions.onAutocomplete("search", async interaction => searchChoices(interaction));

export default {
  fetch: (request: Request) => interactions.acceptHttp(request),
};
```

若宿主并不使用 Web Fetch API，可调用 `ingestHttp({ body, signature, timestamp })` 获得 `{ status, headers, body }` 结构化响应。已经由上游验证的事件可直接交给 `ingest(rawInteraction)`，两者都不会创建监听端口。

使用统一 `DiscordLite` 时，对应方法为 `handleRequest()`、`ingestInteractionHttp()` 和 `ingestInteraction()`；同一个客户端会继续发出 `interactionCreate` 与统一 `dispatch` 事件。

### REST 与自定义传输

```typescript
import { DiscordREST } from "@onebots/adapter-discord/lite";

const rest = new DiscordREST({
  token: process.env.DISCORD_TOKEN!,
  apiBaseUrl: "https://discord.com/api/v10",
  maxRateLimitRetries: 5,
  // transport: existingTransport,
});

await rest.createMessage("123456789012345678", "Hello!");
```

`transport` 可注入已有 HTTP 栈；默认实现不会在代理初始化失败时静默直连。所有非成功响应均抛出 `DiscordError`，其中保留 HTTP 状态、Discord code、retry_after、global 标记和请求 ID。

## 通用消息段

`send_message` 支持 `text`、`at`、`channel`、`reply`、`embed`、`share`、`face`、`image`、`file`、`audio`、`record`、`video` 与原生 `discord_message`。角色提及使用 `at.data.role_id`，频道提及使用 `channel.data.channel_id`。

```typescript
[
  { type: "text", data: { text: "构建产物 " } },
  { type: "at", data: { role_id: "123456789012345678" } },
  { type: "channel", data: { channel_id: "223456789012345678" } },
  { type: "file", data: { file: "/srv/build/app.zip", filename: "app.zip" } },
];
```

媒体来源支持 HTTP(S)、Node.js 本地路径、`file://`、Base64 data URL 和 `base64://`。完整 Discord Create Message 字段可放入 `discord_message.data.body`。

## API 与平台扩展

标准动作按 Discord 原生资源模型暴露为 `get_guild_*` 与 `get_channel_*`，不会把 Guild 伪装成通用 Group。扩展动作可由协议的 `get_supported_actions` 查询：

- 成员：`ban_member`、`unban_member`、`get_guild_bans`、`kick_guild_member`、`timeout_guild_member`、`set_guild_member_nickname`
- 角色：`get_guild_roles`、`create_guild_role`、`update_guild_role`、`delete_guild_role`、`add_guild_member_role`、`remove_guild_member_role`
- 消息：`bulk_delete_messages`、`crosspost_message`、`get_channel_pins`、`pin_message`、`unpin_message`、`get_reaction_users`、`add_reaction`、`remove_own_reaction`、`trigger_typing`
- 线程：`create_thread`、`join_thread`、`leave_thread`、`add_thread_member`、`remove_thread_member`、`list_thread_members`、`get_active_threads`
- 邀请：`get_channel_invites`、`create_channel_invite`、`delete_invite`
- Interaction：`create_interaction_response`、`get_original_interaction_response`、`edit_original_interaction_response`、`create_followup_message`
- 底层：`call_discord_api`，只能访问配置的 Discord API HTTPS 根路径，拒绝外部 URL、路径穿越、内嵌 query 和 fragment

审计类动作可传 `reason`，适配器会按 Discord 要求编码到 `X-Audit-Log-Reason`。

## Discord 应用准备

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 创建 Application。
2. 在 Bot 页面创建 Bot 并取得 Token。
3. Gateway 模式开启实际选择的 Privileged Gateway Intents。
4. Interactions 模式复制 General Information 中的 Application ID 与 Public Key，并配置 Endpoint URL。

## 许可证

MIT
