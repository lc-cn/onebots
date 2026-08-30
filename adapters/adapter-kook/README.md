# @onebots/adapter-kook

KOOK 官方机器人适配器。直接实现 KOOK REST API、Gateway 和 Webhook，不依赖第三方机器人 SDK。

## 配置

```yaml
kook:
  my-bot:
    account_id: my-bot
    token: your-bot-token
    receive_mode: gateway
    # 仅使用 KOOK 登录或用户授权能力时配置
    oauth:
      enabled: true
      client_id: your_oauth_client_id
      client_secret: your_oauth_client_secret
      redirect_uri: https://example.com/oauth/callback
```

`gateway` 是默认接收方式，无需公网回调地址。连接断开后会以带抖动的指数退避无限重连，并优先使用 KOOK session 和 sn 恢复事件流。

已有 Web Host、消息队列或连接管理器时可使用 `receive_mode: manual`。该模式只初始化机器人身份和 REST API，不新建 Gateway，也不注册 Webhook 路由；应用通过 `await ingest(rawEvent)` 把事件交给同一个 Bot。

Webhook 配置示例：

```yaml
kook:
  my-bot:
    account_id: my-bot
    token: your-bot-token
    receive_mode: webhook
    verify_token: your-verify-token
    encrypt_key: optional-encrypt-key
```

在 KOOK 开发者中心填写：

```text
https://你的域名/kook/my-bot/webhook?compress=0
```

`compress=0` 很重要：它让现有 HTTP Host 在解析 JSON 前无需额外处理 deflate 请求体。适配器会完成 challenge、`verify_token` 校验、AES-256-CBC 解密和 sn 去重。反向代理必须保留查询参数和 JSON 请求体。

Webhook 模式必须配置 `verify_token`，未验证的回调不会进入事件管线。管理端会根据 `receive_mode` 动态显示 Webhook 凭据，Gateway 模式下不再展示无关字段。

| 字段           | 说明                                          |
| -------------- | --------------------------------------------- |
| `account_id`   | OneBots 内稳定账号标识                        |
| `token`        | KOOK Bot Token                                |
| `receive_mode` | `gateway`、`webhook` 或 `manual`              |
| `verify_token` | Webhook 回调校验 Token                        |
| `encrypt_key`  | Webhook 加密 Key；未启用加密时不填            |
| `api_base_url` | API 根地址，默认 `https://www.kookapp.cn/api` |
| `max_retries`  | REST 遇到 429 时的最大重试次数，默认 `3`      |
| `oauth`        | 可选用户 OAuth2 应用凭据；默认关闭            |

## 复用已有连接与 HTTP Host

`KookBot` 不要求 SDK 自建 HTTP 端口。已有 Koa Host 由 OneBots 自动注册 `/kook/{account_id}/webhook`；其他运行时可以直接使用底层接入接口：

```ts
import { KookBot, KookWebhookReceiver } from "@onebots/adapter-kook";

const receiver = new KookWebhookReceiver({ verify_token: process.env.KOOK_VERIFY_TOKEN });

// Fetch / WinterCG 风格 Host
const response = await receiver.acceptHttp(request, async (event, signal) => {
  await dispatchToApplication(event, signal);
});

// 已解析 JSON、消息队列或反向代理转交的事件
const result = await receiver.ingest(rawEvent, async (event, signal) => {
  await dispatchToApplication(event, signal);
});

// 使用完整 Bot 时，事件会进入该 Bot 的统一 event 管线
const bot = new KookBot(config);
await bot.ingest(rawEvent, "webhook");

// 已升级 WS / 反向 WS 的 KOOK s=0 信令，复用 Gateway sn 保序器
await bot.ingest(rawSignal, "gateway");

// 上游建立全新 session（不是 resume）时重置 sn 锚点
await bot.resetIngest();
```

`ingest()` 返回 `{ status, body, event?, signal? }` 结构化结果，包含 challenge、重复事件和鉴权失败等响应；调用方可按自己的 Web 框架写回状态与响应体。Webhook 与 Gateway 都会等待 canonical 事件及全部协议出口，只在它们完整成功后确认 `sn`；并发的相同 Webhook 只投递一次。失败的 Webhook 返回 500，Gateway 则保留旧 `sn` 并重连 resume，确保平台能够重投。

入站边界严格遵循 KOOK 官方 JSON 类型：`s`、`sn`、`type` 和 `msg_timestamp` 必须是数字，不会接受数字字符串或用本地时间补齐缺失字段；普通事件必须包含稳定的 `target_id`、`author_id`、`msg_id` 和对象形式的 `extra`。Webhook challenge 使用独立的 `KookWebhookChallenge` 类型，不会伪造成带空 ID 的机器人事件；Gateway HELLO 也经过独立结构校验。

`start()` 会等待异步 `ready` 监听器，`stop()` 会立即使旧启动代次失效、清除旧启动单航班并等待 Gateway 投递队列与全部 `stopped` 监听器。socket 关闭失败不会跳过其余清理，最终通过 `KOOK_STOP_FAILED` 报告。

## 消息与事件

适配器原生收发文字、KMarkdown、图片、视频、音频、文件、Card、提及和回复。单个媒体段使用对应 KOOK 消息类型；混合富媒体会编译为 Card，不会退化成 Markdown 链接。

KOOK 要求图片和视频等素材必须由当前机器人上传。通用媒体段的 `file` / `url` 可使用 HTTP(S) URL、Node.js 本地路径、`file://`、Base64 data URL 或 `base64://`；适配器会先通过 `/v3/asset/create` 上传，再发送 KOOK 素材 URL，避免第三方 URL 导致“找不到资源”。

Gateway 与 Webhook 进入同一条事件投影链路。Gateway 会按官方 `sn` 规则缓冲乱序事件、丢弃重复事件，并在 resume 时从最后确认的序号继续；频道/私聊消息、回应增删、消息编辑/删除、置顶状态、服务器与语音频道成员进出、机器人服务器生命周期、服务器/频道/角色/表情资源变更、成员在线状态、批量黑名单和按钮交互会投影成统一事件。资源生命周期携带标准 `resource` 实体；成员在线/离线按官方 `guilds` 拆成逐服务器稳定 notice，批量黑名单按用户拆分。OneBot 11/12 与 MCP 会保留资源、子类型和 KOOK 扩展，Satori 会使用原生 Guild、Channel 与 GuildRole 事件。编辑事件中的官方 Card 数组会保留为 Card，道具消息（type 12）及未来扩展消息不会被强制转成空字符串；未知系统事件以 `custom` notice 交付，并完整保留在 `raw_event` 和 `extensions.kook` 中。

KOOK 的频道消息与私聊消息使用两套 API。`delete_message`、`get_message` 应提供 `scene_type`；当前进程收发过的消息可以从有界上下文自动识别。KOOK 官方只允许编辑 KMarkdown 和 Card；通用 `update_message` 还要求当前进程已知消息场景，其他场景请使用 `call_kook_api` 显式调用。

## 平台扩展动作

除标准 OneBots 动作外，适配器提供以下原生能力：

- `call_kook_api`：安全调用任意 `/v3/*` API，参数为 `path`、`method`、`query`、`body`
- `upload_asset`：上传 URL、本地文件、data URL 或 Base64 素材并返回 KOOK URL
- 频道与私聊回应：`get_*_reactions`、`add_*_reaction`、`remove_*_reaction`
- 消息置顶：`pin_message`、`unpin_message`
- 服务器角色：`list/create/update/delete/grant/revoke_guild_role`
- 频道权限：`get/create/update/sync/delete_channel_permission`
- 黑名单：`list_blacklist`、`add_blacklist`、`remove_blacklist`
- 服务器语音静音/闭麦与助力历史：`list/add/remove_guild_mute`、`get_guild_boost_history`
- 邀请：`list_invites`、`create_invite`、`delete_invite`
- 邀请用户：`list_invitees`
- 频道/私聊历史与管道消息：`list_channel_messages`、`list_direct_messages`、`send_pipe_message`
- 私聊会话：`list_user_chats`、`get_user_chat`、`create_user_chat`、`delete_user_chat`
- 服务器表情：`list_guild_emojis`、`create_guild_emoji`、`update_guild_emoji`、`delete_guild_emoji`
- 用户亲密度：`get_intimacy`、`update_intimacy`
- 游戏与动态：`list_games`、`create_game`、`update_game`、`delete_game`、`set_game_activity`、`delete_game_activity`
- 消息模板：`list_message_templates`、`create_message_template`、`update_message_template`、`delete_message_template`
- 服务器 Badge：`get_guild_badge`，返回 `content_type` 与 `base64://` 数据
- 帖子：分区、创建、回复、详情、列表、删除和回复列表
- 语音：`move_voice_user`、`kick_voice_user`、`get_joined_voice_channel`，以及 `join_voice_channel`、`list_joined_voice_channels`、`leave_voice_channel`、`keep_voice_channel_alive` 管理机器人推流生命周期
- 机器人在线状态：上线、下线和查询状态
- 好友：目录、申请列表、同意/拒绝、删除，以及 `send_friend_request`、`block_user`、`unblock_user`、`list_blocked_users`
- 用户 OAuth2：`create_oauth_authorization_url`、`exchange_oauth_code`、`get_oauth_user_info`、`list_oauth_user_guilds`，以及受限 GET 底层动作 `call_kook_oauth_api`

命名动作的参数字段与 KOOK 官方 API 保持一致。服务器管理、服务器角色和频道权限动作会在请求前校验官方字段、必填项、枚举、长度与整数范围，未知字段不会被静默转发；尚未收录的新字段应显式使用 `call_kook_api`。`list_guild_mutes` 固定请求官方 `detail` 结构，不保留旧返回格式。所有标准列表按 KOOK 官方单页上限 50 自动遍历，不依赖平台静默截断。统一好友接口会剔除当前账号主动发出的申请；KOOK 不返回申请时间，因此 `get_friend_requests` 的 `time` 明确为 `0`，不会伪造本地时间。权限不足、参数错误和限流会抛出结构化 `KookError` / `KookApiError`，其中包含错误分类、HTTP 状态、KOOK 错误码、请求路径和重试等待时间。REST 客户端按官方 route bucket / global 限流头串行调度，并支持 `AbortSignal`。

OAuth2 使用与 Bot Token 完全隔离的客户端。授权地址动作要求调用方提供不可预测的 `state` 并在回调时自行核验；换码时应用密钥只进入官方 `application/x-www-form-urlencoded` 请求，用户资料与服务器列表只发送 `Authorization: Bearer`。KOOK 当前只支持授权码模式，访问令牌过期后需重新授权，不会伪造平台未提供的刷新流程。`scope` 仅接受官方 `get_user_info` 和 `get_user_guilds`。

## 参考

- [KOOK 开发者文档](https://developer.kookapp.cn/doc/reference)
- [消息接口](https://developer.kookapp.cn/doc/http/message)
- [Webhook](https://developer.kookapp.cn/doc/webhook)
- [Gateway](https://developer.kookapp.cn/doc/websocket)
