# Adachi-BOT

Adachi-BOT is now an activatable OneBots Application with the `experimental` stage. It publishes connection metadata, limitations, and the `get_adachi_bot_application_info` compatibility action for matching `onebot.v11` protocol instances.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t adachi-bot -c config.yaml
```

Or persist the selection:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [adachi-bot]
```

## Runtime capability

| Item | Current value |
| --- | --- |
| Application | `adachi-bot` |
| Stage | `experimental` |
| Protocol | `onebot.v11` |
| Transport | `websocket` |
| Extension action | `get_adachi_bot_application_info` |
| Verification | `documented` |
| Upstream | [Adachi-BOT](https://github.com/SilveryStar/Adachi-BOT) |

Use `GET /api/applications` to inspect effective per-account protocol capabilities. Generate a redacted connection template with:

```bash
onebots frameworks --framework adachi-bot --account <platform.account_id>
```

## Boundaries

The core declares OneBot 11 compatibility, but plugins may depend on implementation-specific actions and require an audit.

This stage can be activated with `-t`, but it will not become `available` until pinned-version interoperability passes.
