# 微信公众号配置

```yaml
wechat.my_mp:
  app_id: wx1234567890abcdef
  app_secret: your_app_secret
  token: your_webhook_token
  encoding_aes_key: your_43_character_key
  webhook_path: /wechat/my_mp/webhook
  passive_reply_timeout_ms: 4500
  deduplicate_webhooks: true
  webhook_deduplication_limit: 10000
  api_base_url: https://api.weixin.qq.com
```

| 字段 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `app_id` | 是 | - | 公众号 AppID，也是加密消息解密后的身份校验值 |
| `app_secret` | 是 | - | 换取 access token 的敏感凭据 |
| `token` | 是 | - | Webhook SHA-1 签名令牌 |
| `encoding_aes_key` | 安全/兼容模式 | - | 43 位消息加解密密钥 |
| `webhook_path` | 否 | `/wechat/{account_id}/webhook` | 复用主 HTTP Host 的回调路径 |
| `passive_reply_timeout_ms` | 否 | `4500` | 等待下游被动回复，最大 4500ms；`0` 表示立即确认 |
| `deduplicate_webhooks` | 否 | `true` | 过滤微信重试投递 |
| `webhook_deduplication_limit` | 否 | `10000` | 最近事件 ID 的进程内缓存上限 |
| `api_base_url` | 否 | `https://api.weixin.qq.com` | 官方兼容 HTTPS 代理或测试入口 |

`app_id`、`app_secret`、`token`、`encoding_aes_key` 均使用 snake_case；不接受历史 camelCase 别名。公众号权限由微信后台决定，不需要也不支持 `account_type` 开关。

账号启动时的首次 access token 请求与后续协议出口共用 OneBots 全局 `timeout`。启动超时、人工停止或配置热重载取消账号时，适配器会中止尚未完成的请求；即使自定义请求实现忽略取消，迟到 token 也不会写入缓存或把旧账号重新标记为在线。账号就绪后仍保留启动信号，协议启动失败时会随账号回滚清理凭据状态。
