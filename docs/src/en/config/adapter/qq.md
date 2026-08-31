# QQ Adapter Configuration

The adapter uses Tencent's official `@tencent-connect/qqbot-nodejs` SDK. WebSocket and Webhook share the same event projection and API surface.

```yaml
qq.my_bot:
  appid: 'your_app_id'
  secret: 'your_app_secret'
  receive_mode: websocket
  markdown_support: false
  intents:
    - GROUP_AND_C2C_EVENT
    - INTERACTION
    - PUBLIC_GUILD_MESSAGES
```

| Field | Type | Default | Description |
|---|---|---|---|
| `appid` | string | required | QQ Open Platform AppID |
| `secret` | string | required | QQ Open Platform AppSecret |
| `receive_mode` | `websocket \| webhook` | `websocket` | Event transport |
| `intents` | string[] | SDK safe defaults | Approved Gateway intents |
| `markdown_support` | boolean | `false` | Whether Markdown permission is enabled |
| `webhook_path` | string | `/qq/{account_id}/webhook` | Callback path on the OneBots HTTP host |
| `api_base_url` | string | SDK default | Compatible OpenAPI proxy/test endpoint |
| `token_base_url` | string | SDK default | Compatible token proxy/test endpoint |

Webhook does not open another port. Preserve the unmodified HTTP body because QQ verifies it with Ed25519. Legacy transport fields and intent aliases are intentionally not interpreted.

Use the `qq_call` platform action or `account.client.call()` for any authenticated QQ OpenAPI relative path that has not received a named wrapper yet.
