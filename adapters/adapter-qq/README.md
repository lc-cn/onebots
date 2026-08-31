# @onebots/adapter-qq

QQ 官方机器人适配器，基于腾讯官方 [`@tencent-connect/qqbot-nodejs`](https://www.npmjs.com/package/@tencent-connect/qqbot-nodejs)。适配器保留官方 SDK 的完整 Client 类型，同时将消息、事件和 OpenAPI 投影到 OneBots 通用能力。

## 能力

- C2C、群聊、频道和频道私信消息
- 图片、语音、视频、文件、Markdown、Ark、Embed 与 Inline Keyboard
- 频道、成员、角色、权限、公告、表态、日程、帖子、音频控制与机器人分享链接
- C2C 主动唤醒、输入状态和流式消息（可直接使用 `account.client`）
- 好友增删、机器人进退群、群与 Guild 成员、消息接收/审核/删除状态、表态与交互事件的标准投影
- 群申请完整投影验证信息与邀请来源；审批可拒绝并加入成员黑名单
- 所有未知 QQ Gateway 事件均通过 `raw_event` 无损下发
- WebSocket 自动恢复；SDK 内部重试耗尽后仍会建立新的连接代次
- Webhook 复用 OneBots 主 HTTP 服务，不另开端口
- Webhook/manual 使用官方验签结果同步投影全部消息、交互与 raw 事件，补齐官方 SDK Webhook 内部忽略的频道和频道私信消息；仅在业务分发成功后确认内容哈希
- `qq_call` 可调用尚未封装的任意 QQ OpenAPI 相对路径

C2C、群聊、频道与频道私信统一从官方 SDK 的 typed `message` 事件投影，不再维护第二套 Gateway 消息猜测逻辑。`raw_event` 直接保存 QQ Gateway 原始载荷；需要 SDK 归一化视图时可使用导出的 `QQInboundMessage` 类型。`qq_call` 的 path 只接受无查询串、无目录穿越的安全相对路径，query 必须单独提供且只能包含字符串、数字或布尔值。

Gateway 生命周期事件会优先投影到 OneBots canonical notice：好友增删、机器人进退群、群与 Guild 成员增改删、消息接收/审核状态、消息删除、表态和交互分别使用 `friend_*`、`group_*`、`member_*`、`message_status`、`message_deleted`、`reaction_*` 与 `interaction`。群申请会保留验证方式、邀请来源、风险提示与自动审批状态。频道、Guild、论坛、音频及未来新增事件使用带结构化用户/频道地址的 `custom` notice；所有分支都保留完整 `raw_event` 与 `extensions.qq`，不会因为标准模型暂未覆盖而丢字段。

消息编译遵循 QQ 平台的单载荷约束：一条消息只能包含一个 Reply、一个 Markdown/Ark/Embed 主载荷及一个 Keyboard。C2C/群聊的文本与首个媒体会合并为原生 caption；频道单条消息只接受一张 HTTPS URL 图片。冲突载荷、多张频道图片和本地频道图片会在请求发出前返回结构化错误，不会静默丢弃消息段。

`upload_file` 返回的是 QQ `file_info` 对应的统一 `file_id`，并携带平台 TTL 计算出的 `expire_time`。该句柄与上传目标会话绑定，可直接放入 C2C/群聊的 `image`、`audio`、`video` 或 `file` 消息段；适配器会还原句柄并以 `msg_type: 7` 发送，不会把它误当成本地文件路径或重复上传。

## 配置

```yaml
qq.my_bot:
  appid: "your_app_id"
  secret: "your_app_secret"
  receive_mode: websocket
  intents:
    - GROUP_AND_C2C_EVENT
    - INTERACTION
    - PUBLIC_GUILD_MESSAGES

  onebot.v12:
    access_token: "your_token"
```

Webhook 模式：

```yaml
qq.my_bot:
  appid: "your_app_id"
  secret: "your_app_secret"
  receive_mode: webhook
  # 可省略，默认 /qq/my_bot/webhook
  webhook_path: "/qq/my_bot/webhook"
```

QQ 开放平台回调地址应指向 OneBots 主端口，例如 `https://bot.example.com/qq/my_bot/webhook`。反向代理必须保留原始请求体，否则 Ed25519 验签会被拒绝。

已有 HTTP Host 可改用手动接入，不注册 OneBots 路由：

```yaml
qq.my_bot:
  appid: "your_app_id"
  secret: "your_app_secret"
  receive_mode: manual
```

宿主将原始请求组装为官方 SDK 的 `WebhookRequest` 后调用 `account.client.ingest(request)`，可获得结构化 `WebhookResponse`；Koa 风格宿主也可调用 `account.client.acceptHttp(ctx)`。两种入口都复用官方 SDK 的验签和事件解码，不另开端口。OneBots 的 canonical 分发会在 HTTP ACK 前完成：业务失败时 `ingest()` 拒绝、`acceptHttp()` 返回 500，QQ 可安全重投；成功事件进入有界内容哈希窗口，重复回调不会再次下发。

旧字段 `mode`、`port`、`path`、`sandbox`、`apiBaseUrl` 和旧 intent 别名不再解释。配置 Schema 会直接生成接收方式、事件订阅和高级端点表单。

## 原生 Client 与 OpenAPI

```ts
const account = qqAdapter.getAccount("my_bot");

// 完整腾讯官方 SDK 类型
await account?.client.sendTyping({ scope: "c2c", targetId: "openid" });

// 统一、认证后的底层 OpenAPI
const guilds = await account?.client.call({
  method: "GET",
  path: "/users/@me/guilds",
});
```

协议侧可通过平台动作调用同一入口：

```json
{
  "action": "qq_call",
  "params": {
    "method": "GET",
    "path": "/users/@me/guilds"
  }
}
```

绝对 URL 会被拒绝，避免令牌被发送到非 QQ OpenAPI 主机。

参数、账号、生命周期和 OpenAPI 故障均使用 `QQApiError`，并接入 OneBots 核心错误分类。协议层可据此稳定区分客户端参数、资源缺失、平台拒绝和网络故障；`code`、HTTP `status` 与 API `path` 不会在包装时丢失。

## 相关链接

- [QQ 开放平台](https://q.qq.com/)
- [腾讯官方 Node.js SDK](https://github.com/tencent-connect/qqbot-nodejs)
- [详细配置文档](../../docs/src/config/adapter/qq.md)
