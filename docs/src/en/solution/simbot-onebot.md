# Simple Robot OneBot

Simple Robot OneBot is now an activatable OneBots Application with the `experimental` stage. It publishes connection metadata, limitations, and the `get_simbot_onebot_application_info` compatibility action for matching `onebot.v11` protocol instances.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t simbot-onebot -c config.yaml
```

Or persist the selection:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [simbot-onebot]
```

## Runtime capability

| Item | Current value |
| --- | --- |
| Application | `simbot-onebot` |
| Stage | `experimental` |
| Protocol | `onebot.v11` |
| Transport | `websocket` |
| Extension action | `get_simbot_onebot_application_info` |
| Verification | `documented` |
| Upstream | [Simple Robot OneBot](https://github.com/simple-robot/simbot-component-onebot) |

Use `GET /api/applications` to inspect effective per-account protocol capabilities. Generate a redacted connection template with:

```bash
onebots frameworks --framework simbot-onebot --account <platform.account_id>
```

## Boundaries

This is a component SDK embedded in a Simbot application, not a standalone bot process.

This stage can be activated with `-t`, but it will not become `available` until pinned-version interoperability passes.
