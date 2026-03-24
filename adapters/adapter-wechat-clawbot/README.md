# @onebots/adapter-wechat-clawbot

OneBots 适配器：**微信 ClawBot / iLink Bot HTTP**。

- 平台标识 / `-r`：**`wechat-clawbot`**

与 **微信公众号**（`adapter-wechat`）、**企业微信**（`wecom`）、**微信客服**（`wecom-kf`）均为不同通道。

## 约定摘要

| 项目 | 说明 |
|------|------|
| API 根 | `https://ilinkai.weixin.qq.com`（适配器固定） |
| CDN 根 | `https://novac2c.cdn.weixin.qq.com/c2c` |
| 会话文件 | `{工作目录}/data/wechat-clawbot/<account_id>.json` |
| context_token | 主库 SQLite 表 **`wechat_clawbot_context_token`**（按 `account_id` + peer） |

YAML 通常只需账号键与可选超时，见文档站 [平台说明](https://github.com/lc-cn/onebots/tree/master/docs/src/platform/wechat-clawbot.md)。

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
