# @onebots/adapter-wechat-clawbot

OneBots 适配器：**微信 ClawBot / iLink Bot HTTP**。提供扫码登录、无限恢复长轮询、复合消息与加密媒体收发，并导出可独立使用的 `IlinkBot` SDK。

- 平台标识 / `-r`：**`wechat-clawbot`**

与 **微信公众号**（`adapter-wechat`）、**企业微信**（`wecom`）、**微信客服**（`wecom-kf`）均为不同通道。

## 约定摘要

| 项目          | 说明                                                                        |
| ------------- | --------------------------------------------------------------------------- |
| API 根        | `https://ilinkai.weixin.qq.com`（适配器固定）                               |
| CDN 根        | `https://novac2c.cdn.weixin.qq.com/c2c`                                     |
| 会话文件      | `{工作目录}/data/wechat-clawbot/<account_id>.json`                          |
| context_token | 主库 SQLite 表 **`wechat_clawbot_context_token`**（按 `account_id` + peer） |

YAML 通常只需账号键与可选超时，见文档站 [平台说明](https://github.com/lc-cn/onebots/tree/master/docs/src/platform/wechat-clawbot.md)。

## 能力边界

- 原生支持私聊文本、图片、视频、文件接收与发送，以及语音接收。
- 每个事件保留 `raw_event`；未知 iLink item 投影为 `wechat_clawbot_raw`，不会伪造成文本。
- iLink 消息可包含多个 item，适配器按原顺序完整投影。
- iLink 未提供好友目录、群聊、消息撤回或历史查询，因此适配器不会返回占位数据。
- 回复依赖有效的 `context_token`。对端尚未发言或 token 已失效时，发送会返回结构化错误。
- 长轮询默认无限重试并采用指数退避；账号停止时会立即取消请求并发送 `notifystop`。

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
await client.ingest(rawEvent); // 宿主已有来源也走同一事件管线
await client.stopPolling();
```

## 安装与启动

```bash
pnpm add @onebots/adapter-wechat-clawbot
```

```yaml
wechat-clawbot.my_bot: {}
```

```bash
onebots -r wechat-clawbot -c config.yaml
```

## 本地构建

```bash
pnpm --filter @onebots/adapter-wechat-clawbot build
```
