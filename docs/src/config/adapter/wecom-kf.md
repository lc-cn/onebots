# 微信客服配置

```yaml
wecom-kf.customer_service:
  corp_id: ww1234567890abcdef
  corp_secret: your_wecom_customer_service_secret
  token: your_callback_token
  encoding_aes_key: your_43_character_key
  open_kfid: wkxxxxxxxxxxxxxxxx
  webhook_path: /wecom-kf/customer_service/webhook
  cursor_store_path: ./data/wecom-kf-cursor.json
  deduplicate_messages: true
  message_deduplication_limit: 10000
  enable_sync_poll: false
  sync_poll_interval_ms: 30000
  api_base_url: https://qyapi.weixin.qq.com
```

| 字段 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `corp_id` | 是 | - | 企业 ID 与回调 receiveid 校验值 |
| `corp_secret` | 是 | - | 微信客服 API Secret |
| `token` | 是 | - | 回调签名 Token |
| `encoding_aes_key` | 是 | - | 43 位回调加解密密钥 |
| `open_kfid` | 否 | - | 没有已知会话上下文时使用的默认客服账号 |
| `webhook_path` | 否 | `/wecom-kf/{account_id}/webhook` | 主 HTTP Host 上的回调路径 |
| `cursor_store_path` | 否 | 仅内存 | 各客服账号的 `sync_msg` 游标文件 |
| `deduplicate_messages` | 否 | `true` | 按 `msgid` 过滤重投消息 |
| `message_deduplication_limit` | 否 | `10000` | 进程内去重集合上限 |
| `enable_sync_poll` | 否 | `false` | 启用无回调 Token 的补偿同步 |
| `sync_poll_interval_ms` | 否 | `30000` | 补偿同步间隔，最小 5000ms |
| `api_base_url` | 否 | 官方地址 | 官方兼容 HTTPS 代理或测试入口 |

本适配器不再读取 `agent_id`，也不接受旧的明文/JSON 回调兼容格式。
