# 企业微信自建应用配置

```yaml
wecom.internal_app:
  corp_id: ww1234567890abcdef
  corp_secret: your_application_secret
  directory_secret: your_address_book_sync_secret # 仅通讯录写入/导入需要
  agent_id: '1000001'
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  receive_mode: webhook
  webhook_path: /wecom/internal_app/webhook
  deduplicate_webhooks: true
  webhook_deduplication_limit: 10000
  api_base_url: https://qyapi.weixin.qq.com
```

| 字段 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `corp_id` | 是 | - | 企业 ID，也是回调解密后的 receiveid 校验值 |
| `corp_secret` | 是 | - | 自建应用 Secret |
| `directory_secret` | 通讯录写入/导入 | - | 通讯录同步 Secret；使用独立 token，不会回退到应用 Secret |
| `agent_id` | 是 | - | 数字形式的应用 AgentID |
| `token` | Webhook | - | 接收消息回调签名 Token |
| `encoding_aes_key` | Webhook | - | 43 位回调加解密密钥 |
| `receive_mode` | 否 | `webhook` | `webhook` 复用主 Host；`manual` 由既有 Host/队列调用 `ingest()` |
| `webhook_path` | 否 | `/wecom/{account_id}/webhook` | 复用主 HTTP Host 的路径 |
| `deduplicate_webhooks` | 否 | `true` | 过滤企业微信重试投递 |
| `webhook_deduplication_limit` | 否 | `10000` | 最近事件 ID 的进程内缓存上限 |
| `api_base_url` | 否 | `https://qyapi.weixin.qq.com` | 官方兼容 HTTPS 代理或测试入口 |

`manual` 模式不注册路由，且不要求 `token` / `encoding_aes_key`；可信来源需直接 `await client.ingest(decryptedEvent)`。Webhook 模式不接受明文回调，也不提供历史配置别名。

首次应用凭证与身份校验请求、异步就绪监听器和后续协议出口共用 OneBots 全局 `timeout`。启动超时、人工停止或配置热重载会中止在途请求，并通过启动代次阻止忽略取消的迟到响应恢复在线状态；账号就绪后仍保留启动信号，因此协议启动失败也能完整回滚客户端状态。
