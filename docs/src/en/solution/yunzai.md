# 云崽 / TRSS-Yunzai

云崽 / TRSS-Yunzai is available through the OneBots Application runtime. Activate it with `-t yunzai`; the Application is applied to every protocol instance and publishes its connections, actions, routes, and limitations.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t yunzai -c config.yaml
```

Persist the same selection with:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [yunzai]
```

## Connection capability

| Item | Current value |
| --- | --- |
| Application | `yunzai` |
| Protocol | `onebot.v11` |
| Transport | `reverse-websocket` |
| Pinned gate | `source audit 2d1652ac` |

Query `GET /api/applications` for runtime state. Registered protocols other than `onebot.v11` are reported as `unsupported` rather than being presented as compatible.

## Limitations

The Yunzai audit still has 28 unsupported private actions around files, notices, guilds, and QQ profiles.

See the [framework overview](/en/solution/frameworks) for generated configuration and audit evidence.
