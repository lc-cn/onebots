# @onebots/adapter-kook

KOOK 官方机器人适配器。直接实现 KOOK REST API、Gateway 和 Webhook，不依赖第三方机器人 SDK。

## 配置

```yaml
kook:
  my-bot:
    account_id: my-bot
    token: your-bot-token
    receive_mode: gateway
```

`gateway` 是默认接收方式，无需公网回调地址。连接断开后会以带抖动的指数退避无限重连，并优先使用 KOOK session 和 sn 恢复事件流。

已有 Web Host、消息队列或连接管理器时可使用 `receive_mode: manual`。该模式只初始化机器人身份和 REST API，不新建 Gateway，也不注册 Webhook 路由；应用通过 `ingest(rawEvent)` 把事件交给同一个 Bot。

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

## 复用已有连接与 HTTP Host

`KookBot` 不要求 SDK 自建 HTTP 端口。已有 Koa Host 由 OneBots 自动注册 `/kook/{account_id}/webhook`；其他运行时可以直接使用底层接入接口：

```ts
import { KookBot, KookWebhookReceiver } from "@onebots/adapter-kook";

const receiver = new KookWebhookReceiver({ verify_token: process.env.KOOK_VERIFY_TOKEN });

// Fetch / WinterCG 风格 Host
const response = await receiver.acceptHttp(request);

// 已解析 JSON、消息队列或反向代理转交的事件
const result = receiver.ingest(rawEvent);

// 使用完整 Bot 时，事件会进入该 Bot 的统一 event 管线
const bot = new KookBot(config);
bot.ingest(rawEvent, "webhook");

// 已升级 WS / 反向 WS 的 KOOK s=0 信令，复用 Gateway sn 保序器
bot.ingest(rawSignal, "gateway");

// 上游建立全新 session（不是 resume）时重置 sn 锚点
bot.resetIngest();
```

`ingest()` 返回 `{ status, body, event?, signal? }` 结构化结果，包含 challenge、重复事件和鉴权失败等响应；调用方可按自己的 Web 框架写回状态与响应体。

## 消息与事件

适配器原生收发文字、KMarkdown、图片、视频、音频、文件、Card、提及和回复。单个媒体段使用对应 KOOK 消息类型；混合富媒体会编译为 Card，不会退化成 Markdown 链接。

KOOK 要求图片和视频等素材必须由当前机器人上传。通用媒体段的 `file` / `url` 可使用 HTTP(S) URL、Node.js 本地路径、`file://`、Base64 data URL 或 `base64://`；适配器会先通过 `/v3/asset/create` 上传，再发送 KOOK 素材 URL，避免第三方 URL 导致“找不到资源”。

Gateway 与 Webhook 进入同一条事件投影链路。Gateway 会按官方 `sn` 规则缓冲乱序事件、丢弃重复事件，并在 resume 时从最后确认的序号继续；频道/私聊消息、回应增删、消息编辑/删除、成员进出和按钮交互会投影成统一事件。道具消息（type 12）及未来扩展消息不会被强制转成空字符串；未知系统事件以 `custom` notice 交付，并完整保留在 `raw_event` 和 `extensions.kook` 中。

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
- 消息模板：`list_message_templates`
- 服务器 Badge：`get_guild_badge`，返回 `content_type` 与 `base64://` 数据
- 帖子：分区、创建、回复、详情、列表、删除和回复列表
- 语音：移动/踢出用户、查询用户所在语音频道
- 机器人在线状态：上线、下线和查询状态

命名动作的参数字段与 KOOK 官方 API 保持一致。权限不足、参数错误和限流会抛出结构化 `KookError` / `KookApiError`，其中包含错误分类、HTTP 状态、KOOK 错误码、请求路径和重试等待时间。REST 客户端按官方 route bucket / global 限流头串行调度，并支持 `AbortSignal`。

## 参考

- [KOOK 开发者文档](https://developer.kookapp.cn/doc/reference)
- [消息接口](https://developer.kookapp.cn/doc/http/message)
- [Webhook](https://developer.kookapp.cn/doc/webhook)
- [Gateway](https://developer.kookapp.cn/doc/websocket)
