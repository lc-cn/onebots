# Koishi

Koishi is available through the OneBots Application runtime. Activate it with `-t koishi`; the Application is applied to every protocol instance and publishes its connections, actions, routes, and limitations.

## Start

```bash
onebots -r <adapter> -p satori-v1 -t koishi -c config.yaml
```

Persist the same selection with:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [satori-v1]
  applications: [koishi]
```

## Connection capability

| Item | Current value |
| --- | --- |
| Application | `koishi` |
| Protocol | `satori.v1` |
| Transport | `websocket` |
| Pinned gate | `4.18.6 / adapter 1.5.1` |

Query `GET /api/applications` for runtime state. Registered protocols other than `satori.v1` are reported as `unsupported` rather than being presented as compatible.

## Limitations

The current gate covers handshake, private messages, and basic identity/send actions. Group, rich-media, and reconnect matrices remain incomplete.

See the [framework overview](/en/solution/frameworks) for generated configuration and audit evidence.
