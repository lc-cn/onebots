# WeChat ClawBot (iLink) adapter

Connects to **WeChat extension / iLink Bot HTTP**. This is **not** the WeChat Official Account adapter (`wechat`), WeCom (`wecom`), or WeCom Customer Service (`wecom-kf`).

- Package: [`@onebots/adapter-wechat-clawbot`](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wechat-clawbot)
- Platform id / `-r`: **`wechat-clawbot`**
- Product: [WeChat iLink](https://ilinkai.weixin.qq.com)

## vs. Official Account adapter

| | `@onebots/adapter-wechat` | `@onebots/adapter-wechat-clawbot` |
|---|---------------------------|-----------------------------------|
| Use case | Public account webhook | iLink HTTP API, QR login, long polling |
| Config | `app_id`, `token`, etc. | Mainly `account_id`; endpoints are conventional |
| Platform id | `wechat` | **`wechat-clawbot`** |

## Quick start

```bash
pnpm add @onebots/adapter-wechat-clawbot
```

```yaml
wechat-clawbot.my_bot: {}
```

```bash
onebots -r wechat-clawbot -c config.yaml
```

Full details: see the adapter README in the monorepo.

- [WeChat ClawBot adapter configuration](/en/config/adapter/wechat-clawbot)
- [中文文档](/platform/wechat-clawbot)
