# 微信 ClawBot（iLink）适配器

微信 **扩展能力（iLink Bot HTTP）** 接入说明，与 **微信公众号**（`adapter-wechat`）、**企业微信**（`wecom`）、**微信客服**（`wecom-kf`）均为不同通道。

- 包名：[`@onebots/adapter-wechat-clawbot`](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wechat-clawbot)
- 平台标识 / `-r`：**`wechat-clawbot`**
- 官方产品页：[微信 iLink 智能体](https://ilinkai.weixin.qq.com)

## 与微信公众号适配器的区别

| 项目 | `adapter-wechat` | `adapter-wechat-clawbot` |
|------|------------------|---------------------------|
| 场景 | 公众平台服务器配置、Webhook | iLink HTTP API、扫码登录、内置长轮询或手动事件源 |
| 配置 | `app_id` / `token` 等 | `account_id`、接收模式；端点与会话由适配器约定 |
| 平台 ID | `wechat` | **`wechat-clawbot`** |

可同时安装，配置段分别为 `wechat.*` 与 `wechat-clawbot.*`。

## 功能摘要

- 扫码登录、IDC 节点跳转、手机数字配对码、凭证失效后自动重扫码
- 可取消的无限长轮询、指数退避与 iLink `notifystart` / `notifystop` 生命周期
- `receive_mode: manual` 复用登录态与出站 API，但不创建 `getupdates`；已有 Host 通过 `await WechatIlinkBot.ingest()` 投递原始事件，协议投影成功后才提交事件身份
- 文本、图片、视频、文件双向收发，语音与未知 item 无损接收
- 复合消息、引用消息与工具调用进度按原顺序投影，并始终保留 `raw_event`
- `context_token` 写入主库 SQLite；回复依赖对端先发或显式传入有效 token
- Web 管理端验证流动态展示二维码或数字配对码输入框
- 完整 CDN URL 优先、上传失败重试、typing ticket 自动刷新
- 会话文件原子 `0600` 写入、BOT 回送副本过滤
- 单条坏事件隔离，整批投递完成后再持久化同步游标
- `send_typing` 与 `download_media` 平台扩展动作

iLink 没有好友目录、撤回或历史查询接口；适配器不会用会话身份伪造这些能力。当前通道不声明群聊发送，但上游若实际下发 `group_id`，事件会准确保留为群场景。

完整说明、合规提示、会话路径与表结构见包内 README。

## 快速开始

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

## 参考

- [微信 ClawBot 适配器配置](/config/adapter/wechat-clawbot)
