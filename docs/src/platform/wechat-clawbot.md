# 微信 ClawBot（iLink）适配器

微信 **扩展能力（iLink Bot HTTP）** 接入说明，与 **微信公众号**（`adapter-wechat`）、**企业微信**（`wecom`）、**微信客服**（`wecom-kf`）均为不同通道。

- 包名：[`@onebots/adapter-wechat-clawbot`](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wechat-clawbot)
- 平台标识 / `-r`：**`wechat-clawbot`**
- 官方产品页：[微信 iLink 智能体](https://ilinkai.weixin.qq.com)

## 与微信公众号适配器的区别

| 项目 | `adapter-wechat` | `adapter-wechat-clawbot` |
|------|------------------|---------------------------|
| 场景 | 公众平台服务器配置、Webhook | iLink HTTP API、扫码登录、长轮询收消息 |
| 配置 | `app_id` / `token` 等 | 仅需 `account_id`，端点与会话由适配器约定 |
| 平台 ID | `wechat` | **`wechat-clawbot`** |

可同时安装，配置段分别为 `wechat.*` 与 `wechat-clawbot.*`。

## 功能摘要

- 扫码登录、会话落盘、凭证失效后自动重扫码（可选调超时）
- `context_token` 写入主库 SQLite，私聊主动消息依赖对端先发或已缓存 token
- Web 管理端 `verification:request` 展示二维码（与 icqq 验证流一致）

完整说明、合规提示、会话路径与表结构见包内 README。

## 快速开始

```bash
pnpm add @onebots/adapter-wechat-clawbot
```

```yaml
wechat-clawbot.my_bot: {}
```

```bash
onebots -r wechat-clawbot -c config.yaml
```

## 参考

- [微信 ClawBot 适配器配置](/config/adapter/wechat-clawbot)
