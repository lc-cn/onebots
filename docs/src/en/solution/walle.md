# Walle

Walle is now an activatable OneBots Application with the `experimental` stage. It publishes connection metadata, limitations, and the `get_walle_application_info` compatibility action for matching `onebot.v12` protocol instances.

## Start

```bash
onebots -r <adapter> -p onebot-v12 -t walle -c config.yaml
```

Or persist the selection:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v12]
  applications: [walle]
```

## Runtime capability

| Item | Current value |
| --- | --- |
| Application | `walle` |
| Stage | `experimental` |
| Protocol | `onebot.v12` |
| Transport | `websocket` |
| Extension action | `get_walle_application_info` |
| Verification | `documented` |
| Upstream | [Walle](https://github.com/onebot-walle/walle) |

Use `GET /api/applications` to inspect effective per-account protocol capabilities. Generate a redacted connection template with:

```bash
onebots frameworks --framework walle --account <platform.account_id>
```

## Boundaries

Only the OneBot 12 WebSocket application side is declared; HTTP/WebHook and the complete action matrix are unverified.

This stage can be activated with `-t`, but it will not become `available` until pinned-version interoperability passes.
