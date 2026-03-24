# 微信 ClawBot 适配器配置

平台名 **`wechat-clawbot`**。约定大于配置：多数项由适配器固定，YAML 通常只需账号段与可选超时。

## 配置格式

```yaml
wechat-clawbot.{account_id}:
  # 可选
  # qr_login_timeout_ms: 480000
  # polling_timeout_ms: ...
  # polling_retry_delay_ms: ...
```

## 配置项说明

| 字段名 | 类型 | 必填 | 描述 |
|--------|------|------|------|
| `account_id` | string | 是 | 写在配置键名中（`wechat-clawbot.xxx` 的 `xxx`），OneBots 内唯一 |
| `qr_login_timeout_ms` | number | 否 | 扫码登录总超时（毫秒），默认 `480000` |
| `polling_timeout_ms` | number | 否 | `getupdates` 长轮询超时 |
| `polling_retry_delay_ms` | number | 否 | 轮询出错后的重试间隔 |

API 根、CDN、`bot_type`、默认扫码登录等**不在 YAML 填写**，见适配器 README 中的约定表。

## 相关文档

- [微信 ClawBot 平台说明](/platform/wechat-clawbot)
- 源码 README：[`adapters/adapter-wechat-clawbot`](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wechat-clawbot)
