# 真寻

真寻 is available through the OneBots Application runtime. Activate it with `-t zhenxun`; the Application is applied to every protocol instance and publishes its connections, actions, routes, and limitations.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t zhenxun -c config.yaml
```

Persist the same selection with:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [zhenxun]
```

## Connection capability

| Item | Current value |
| --- | --- |
| Application | `zhenxun` |
| Protocol | `onebot.v11` |
| Transport | `reverse-websocket` |
| Pinned gate | `source audit 39ed1ade` |

Query `GET /api/applications` for runtime state. Registered protocols other than `onebot.v11` are reported as `unsupported` rather than being presented as compatible.

## Limitations

Audited core actions are covered, while third-party plugins and a full-process gate remain unverified.

See the [framework overview](/en/solution/frameworks) for generated configuration and audit evidence.
