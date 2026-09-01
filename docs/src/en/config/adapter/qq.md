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
| `receive_mode` | `websocket \| webhook \| manual` | `websocket` | Event transport |
| `intents` | string[] | SDK safe defaults | Approved Gateway intents |
| `markdown_support` | boolean | `false` | Whether Markdown permission is enabled |
| `webhook_path` | string | `/qq/{account_id}/webhook` | Callback path on the OneBots HTTP host |
| `api_base_url` | string | SDK default | Compatible OpenAPI proxy/test endpoint |
| `token_base_url` | string | SDK default | Compatible token proxy/test endpoint |

Webhook does not open another port. Preserve the unmodified HTTP body because QQ verifies it with Ed25519. With `manual`, an existing host passes the raw request to `account.client.ingest(request)` or `acceptHttp(ctx)` and OneBots registers no route. Legacy transport fields and intent aliases are intentionally not interpreted.

The generated form renders intents as a validated multi-select. The adapter also resolves `/users/@me` before starting its receive transport, so canonical events and status use the platform bot ID instead of the internal account alias.

Account startup waits for the first Gateway or Webhook `READY` before starting protocol outlets. Identity verification, the initial transport handshake, and protocol outlets share the global OneBots `timeout`. A timeout, manual stop, or configuration reload closes the receiver and discards a late identity response. The startup signal remains attached after READY so a failed protocol startup can roll back the connection. After the first successful startup, disconnect recovery continues through the adapter's existing unbounded backoff loop.

Use the `qq_call` platform action or `account.client.call()` for any authenticated QQ OpenAPI relative path that has not received a named wrapper yet.
