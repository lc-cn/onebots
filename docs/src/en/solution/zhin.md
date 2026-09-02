# Zhin

Zhin is available through the OneBots Application runtime. Activate it with `-t zhin`; the Application is applied to every protocol instance and publishes its connections, actions, routes, and limitations.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t zhin -c config.yaml
```

Persist the same selection with:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [zhin]
```

## Connection capability

| Item | Current value |
| --- | --- |
| Application | `zhin` |
| Protocol | `onebot.v11` |
| Transport | `websocket` |
| Pinned gate | `6.0.15 / adapter 7.0.8` |

Query `GET /api/applications` for runtime state. Registered protocols other than `onebot.v11` are reported as `unsupported` rather than being presented as compatible.

## Zhin-specific extension

`@onebots/application-zhin` is an independent npm package. For every OneBot 11 protocol instance it adds:

- a dedicated `/<platform>/<account>/onebot/v11/applications/zhin` forward WebSocket;
- the `get_zhin_application_info` extension action;
- token validation, lifecycle events, action calls, and event delivery;
- connection and action capabilities exposed by the management API.

The dedicated route starts with `-t zhin` even when the base protocol's `use_ws` option is `false`.

## Limitations

The current gate covers handshake, private messages, and basic identity/send actions. Group, rich-media, and reconnect matrices remain incomplete.

See the [framework overview](/en/solution/frameworks) for generated configuration and audit evidence.
