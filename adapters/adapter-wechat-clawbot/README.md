# @onebots/adapter-wechat-clawbot

OneBots 适配器：**微信 ClawBot / iLink Bot HTTP**。提供扫码登录、无限恢复长轮询、复合消息与加密媒体收发，并导出可独立使用的 `IlinkBot` SDK。

- 平台标识 / `-r`：**`wechat-clawbot`**

与 **微信公众号**（`adapter-wechat`）、**企业微信**（`wecom`）、**微信客服**（`wecom-kf`）均为不同通道。

## 约定摘要

| 项目          | 说明                                                                        |
| ------------- | --------------------------------------------------------------------------- |
| API 根        | `https://ilinkai.weixin.qq.com`（适配器固定）                               |
| CDN 根        | `https://novac2c.cdn.weixin.qq.com/c2c`                                     |
| 会话文件      | `{工作目录}/data/wechat-clawbot/<URL 编码 account_id>.json`                 |
| context_token | 主库 SQLite 表 **`wechat_clawbot_context_token`**（按 `account_id` + peer） |

YAML 通常只需账号键、接收模式与可选超时，见文档站 [平台说明](https://github.com/lc-cn/onebots/tree/master/docs/src/platform/wechat-clawbot.md)。

## 能力边界

- 原生支持私聊文本、图片、视频、文件接收与发送，以及语音接收。出站媒体统一支持 HTTP(S)、本地路径、`file://`、`data:` URL 与 `base64://`/标准 `data` 字段。
- 每个事件保留 `raw_event`；未知 iLink item 投影为 `wechat_clawbot_raw`，不会伪造成文本。
- iLink 消息可包含多个 item，适配器按原顺序完整投影。
- 引用消息投影为标准 `reply` 段；工具调用进度保留为平台原生段。上游若实际下发 `group_id`，会按群消息投影，但当前通道不承诺群聊发送能力。
- iLink 未提供好友目录、消息撤回或历史查询 API，因此适配器不会返回占位数据。
- 回复依赖有效的 `context_token`。对端尚未发言或 token 已失效时，发送会返回结构化错误。
- 长轮询默认无限重试并采用指数退避；初始化、扫码重登和轮询共享同一生命周期代次，账号停止后旧异步任务不能重新拉起连接。
- `receive_mode: manual` 仍加载或扫码取得 iLink 会话，以保留出站 API 与 `context_token`；但不会启动 `getupdates`，已有 Host 应把原始事件交给同一个 `WechatIlinkBot.ingest()`。凭证失效重登后也不会偷偷恢复内置轮询。
- `ingest(rawEvent)` 会校验方向、发送者、稳定消息标识与 `item_list`；上游回送的 BOT 副本会被忽略，不会触发自回复或污染上下文。
- 仅缺少稳定身份的毒事件会逐条隔离；业务监听器与文本绑定失败会保留旧游标并重拉，同批已成功事件由有界窗口去重。会话文件写入失败也会回滚内存游标。

## 当前 iLink 协议

- 请求使用 `iLink-App-Id: bot`、从发布包版本动态生成的整数客户端版本，以及带 `bot_agent` 的 `base_info`；不手工设置 Node 24 不接受的 `Content-Length`。
- 二维码通过 POST 创建，支持 `scaned_but_redirect` IDC 切换与手机数字配对码；Web 验证面板会动态显示安全输入框。
- 媒体优先使用服务端下发的 `upload_full_url` / `full_url`，缺失时才按 CDN 句柄构造地址。
- CDN 上传对网络错误与 5xx 最多重试 3 次；typing ticket 使用 24 小时有界缓存，服务端拒绝旧票据时刷新一次。
- 会话文件原子写入并固定为仅所有者可读写（`0600`）；损坏文件返回结构化错误，不会静默当成未登录。

## 平台扩展动作

通过 `callAction(accountId, action, params)` 调用：

| 动作             | 参数                                       | 说明                                                     |
| ---------------- | ------------------------------------------ | -------------------------------------------------------- |
| `send_typing`    | `user_id`、可选 `context_token` / `status` | 发送 `active` 或 `idle` 输入状态                         |
| `download_media` | `message_id`、可选 `item_index`            | 下载复合消息中的指定加密媒体，返回 Base64、MIME 与文件名 |

最近媒体缓存保留 256 条事件；长期保存应在收到事件后及时下载。

## 独立 SDK

```ts
import { IlinkBot } from "@onebots/adapter-wechat-clawbot";

const client = new IlinkBot({ sessionStore: "./session.json" });
client.on("message", event => console.info(event));

await client.startPolling();
const event = await client.ingest(rawEvent); // BOT 回送副本返回 undefined
await client.stopPolling();
```

`IlinkBot` 导出完整 `IlinkBotEvents`，`message`、媒体分型、登录、凭证失效、轮询与监听器错误均保留精确参数类型；`GatewayFault` 继承 OneBots 核心错误并携带分类与操作上下文。

## 安装与启动

```bash
pnpm add @onebots/adapter-wechat-clawbot
```

```yaml
wechat-clawbot.my_bot:
  receive_mode: polling # 或 manual
```

```bash
onebots -r wechat-clawbot -c config.yaml
```

## 本地构建

```bash
pnpm --filter @onebots/adapter-wechat-clawbot build
```
