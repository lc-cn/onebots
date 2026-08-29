# Zulip 配置

## 必填凭证

| 配置项 | 类型 | 说明 |
| --- | --- | --- |
| `server_url` | string | Zulip 组织根地址，例如 `https://example.zulipchat.com` |
| `email` | string | Bot 的 Zulip API 邮箱 |
| `api_key` | string | Bot API Key，Web 中按敏感字段展示 |

`server_url` 不包含 `/api/v1`。旧的 `serverUrl`、`apiKey`、`websocket` 已移除；Zulip 实时协议是 Event Queue 长轮询，不是 WebSocket。

## 消息与事件队列

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `default_topic` | `general` | 发送目标只有频道 ID 时的话题 |
| `event_queue.enabled` | `true` | 是否消费实时事件 |
| `event_queue.event_types` | 内置集合 | 可在 Web 表单动态增减的官方事件类型 |
| `event_queue.all_public_streams` | `false` | 是否接收所有可访问公共频道消息 |
| `event_queue.retry_initial_delay_ms` | `1000` | 断线初始退避 |
| `event_queue.retry_max_delay_ms` | `30000` | 退避上限；重试次数始终无限 |

```yaml
zulip.team-bot:
  server_url: https://example.zulipchat.com
  email: onebots-bot@example.zulipchat.com
  api_key: your-api-key
  default_topic: general
  event_queue:
    enabled: true
    event_types:
      - message
      - update_message
      - delete_message
      - reaction
      - subscription
      - realm_user
    all_public_streams: false
    retry_initial_delay_ms: 1000
    retry_max_delay_ms: 30000
  onebot.v11:
    access_token: your-token
```

## 代理

```yaml
  proxy:
    url: socks5://127.0.0.1:1080
    username: optional-user
    password: optional-password
```

支持 HTTP(S) 与 SOCKS 代理；代理依赖不可用时启动会明确失败，不会静默改为直连。

更多能力与场景 ID 见 [Zulip 平台说明](/platform/zulip)。
