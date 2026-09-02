# 炸毛框架

炸毛框架 is now an activatable OneBots Application with the `experimental` stage. It publishes connection metadata, limitations, and the `get_zhamao_application_info` compatibility action for matching `onebot.v11` protocol instances.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t zhamao -c config.yaml
```

Or persist the selection:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [zhamao]
```

## Runtime capability

| Item | Current value |
| --- | --- |
| Application | `zhamao` |
| Stage | `experimental` |
| Protocol | `onebot.v11` |
| Transport | `websocket` |
| Extension action | `get_zhamao_application_info` |
| Verification | `documented` |
| Upstream | [炸毛框架](https://github.com/zhamao-robot/zhamao-framework) |

Use `GET /api/applications` to inspect effective per-account protocol capabilities. Generate a redacted connection template with:

```bash
onebots frameworks --framework zhamao --account <platform.account_id>
```

## Boundaries

PHP runtime and OneBot driver versions vary; verify the generated fields against the selected upstream release.

This stage can be activated with `-t`, but it will not become `available` until pinned-version interoperability passes.
