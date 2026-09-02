# Karin

Karin is available through the OneBots Application runtime. Activate it with `-t karin`; the Application is applied to every protocol instance and publishes its connections, actions, routes, and limitations.

## Start

```bash
onebots -r <adapter> -p milky-v1 -t karin -c config.yaml
```

Persist the same selection with:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [milky-v1]
  applications: [karin]
```

## Connection capability

| Item | Current value |
| --- | --- |
| Application | `karin` |
| Protocol | `milky.v1` |
| Transport | `websocket` |
| Pinned gate | `1.15.3 / adapter 1.3.3` |

Query `GET /api/applications` for runtime state. Registered protocols other than `milky.v1` are reported as `unsupported` rather than being presented as compatible.

## Limitations

The current gate covers handshake, private messages, and basic identity/send actions. Group, rich-media, and reconnect matrices remain incomplete.

See the [framework overview](/en/solution/frameworks) for generated configuration and audit evidence.
