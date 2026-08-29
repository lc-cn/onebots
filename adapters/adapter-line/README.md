# @onebots/adapter-line

基于官方 `@line/bot-sdk` 11.x 的 OneBots LINE Messaging API 适配器。适配器复用 OneBots 的 Koa 服务接收 Webhook，不会自行监听新端口。

## 安装与配置

```bash
pnpm add @onebots/adapter-line
```

```yaml
line.my-line-bot:
  channel_access_token: "..."
  channel_secret: "..."
  deduplicate_webhooks: true
```

在 LINE Developers Console 中把 Webhook URL 设置为：

```text
https://your-domain.example/line/my-line-bot/webhook
```

| 配置项                        | 说明                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| `channel_access_token`        | Messaging API Channel Access Token                         |
| `channel_secret`              | Webhook HMAC-SHA256 验签密钥                               |
| `deduplicate_webhooks`        | 按 `webhookEventId` 持久化忽略重复投递，默认 `true`        |
| `webhook_deduplication_limit` | 每账号持久化去重窗口，默认 10000                           |
| `api_base_url`                | Messaging API 地址，默认 `https://api.line.me`             |
| `data_api_base_url`           | 媒体与 Rich Menu 图片地址，默认 `https://api-data.line.me` |

两个 Base URL 只用于官方兼容实现、可信代理或测试环境，必须使用 HTTPS。官方 SDK 11.x 需要 Node.js 22+，OneBots 当前要求 Node.js 24+。

## Webhook 安全与事件

适配器只使用未经修改的 `rawBody` 验证 `x-line-signature`，不会对已经 JSON 解析再序列化的请求体做降级验签。LINE 重投递会按 `webhookEventId` 去重；所有投影事件都保留 `raw_event`。

已投影的标准事件包括：

- 文本、图片、视频、音频、文件、位置、Sticker 消息；
- `messageEdited` → `message_updated`；
- `unsend` → `message_deleted`；
- follow / unfollow、成员加入 / 离开、postback；
- join / leave、会员、Beacon、账号绑定、视频播放完成、模块生命周期等作为 `custom` 事件无损交付。

LINE 可能重复投递且顺序改变；业务需要以事件 `timestamp` 判断编辑事件的新旧。用户撤回事件到达后，应同步清除业务侧保存的原消息内容。

## 消息能力

通用段支持 `text`、`at`、`reply`、`image`、`video`、`audio` / `voice`、`location`、`sticker`。媒体 URL 必须是公开 HTTPS URL。`reply` 发送需要 LINE 原生 `quote_token`，不能用普通消息 ID 代替。

任意官方 Message 可通过 `line_message` 段发送，因此 Flex、Template、Imagemap、Coupon、Quick Reply、发送者样式及后续 SDK 新消息类型不需要在 OneBots 重复建模：

```ts
await adapter.sendMessage(accountId, {
  scene_type: "private",
  scene_id: userId,
  message: [
    {
      type: "line_message",
      data: {
        message: {
          type: "flex",
          altText: "订单详情",
          contents: { type: "bubble", body: { type: "box", layout: "vertical", contents: [] } },
        },
      },
    },
  ],
});
```

LINE 每次最多发送 5 条 Message。通用 `sendMessage` 会按 5 条自动分批，并为每批生成独立 retry key，避免网络重试造成重复发送。

未知消息段会返回 `LINE_UNSUPPORTED_SEGMENT`，不会在混合消息中静默丢失。启动时的官方 API 身份探针会无限退避重试；Webhook 路由始终复用 OneBots HTTP Host，停止账号会同时取消后台探针。

## 原生扩展动作

平台动作使用显式白名单，不开放任意 SDK 方法反射调用。

- 消息：`push_message`、`reply_message`、`multicast`、`broadcast`、`narrowcast`、请求校验、窄播进度、电话通知消息、`show_loading_animation`、两种已读动作；
- 内容：下载原内容/预览、查询转码状态，二进制以 `data_base64` 返回；
- 用户与聊天：followers、room 成员、account link token；
- Rich Menu：创建、校验、查询、列表、删除、图片上传/下载、默认菜单、按用户及批量关联、alias、batch；
- Coupon：创建、查询、分页列表与关闭；
- 会员：计划列表、用户订阅、已加入用户；
- 运维：Webhook 查询/设置/测试、消息配额、分类发送量、aggregation unit 与用量；
- 洞察：好友数/画像、消息送达、消息互动、aggregation unit、Rich Menu 汇总与逐日统计。

各动作的参数名与完整清单可通过 `get_supported_actions` 和适配器能力清单获取。部分接口受 LINE Official Account 所在地区、认证状态、套餐或专项权限限制；适配器会保留官方 HTTP 状态和错误体并抛出 `LineApiError`。

## 官方限制

- LINE 不提供机器人撤回已发送消息的 API；`deleteMessage` 会返回结构化“不支持”错误。
- LINE 不提供任意历史消息查询；媒体只能在收到 Webhook 后用消息 ID 下载，且会在一段时间后失效。
- LINE 不提供“机器人所在全部群聊”接口；`getGroupList` 返回从 Webhook 持久化得到的已知 group/room。
- `getFriendList` 映射官方 Get followers，能否调用取决于账号条件，不会伪造空列表。

参考：[Messaging API reference](https://developers.line.biz/en/reference/messaging-api/)、[Receive messages](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)、[Rich menus](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/)。

## 直接使用客户端

```ts
import { LineBot } from "@onebots/adapter-line";

const bot = new LineBot({
  account_id: "my-line-bot",
  channel_access_token: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  channel_secret: process.env.LINE_CHANNEL_SECRET!,
});

await bot.pushMessage("U...", [{ type: "text", text: "Hello" }]);
const officialClient = bot.getClient();
const quota = await officialClient.getMessageQuota();
```
