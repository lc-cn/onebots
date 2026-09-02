# AstrBot

AstrBot is available through the OneBots Application runtime. Activate it with `-t astrbot`; the Application is applied to every protocol instance and publishes its connections, actions, routes, and limitations.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t astrbot -c config.yaml
```

Persist the same selection with:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [astrbot]
```

## Connection capability

| Item | Current value |
| --- | --- |
| Application | `astrbot` |
| Protocol | `onebot.v11` |
| Transport | `reverse-websocket` |
| Pinned gate | `4.28.0b1 / adapter 1.4.4` |

Query `GET /api/applications` for runtime state. Registered protocols other than `onebot.v11` are reported as `unsupported` rather than being presented as compatible.

## Limitations

The current gate covers handshake, private messages, and basic identity/send actions. Group, rich-media, and reconnect matrices remain incomplete.

See the [framework overview](/en/solution/frameworks) for generated configuration and audit evidence.
