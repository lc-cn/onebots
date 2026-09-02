# PepperBot

PepperBot is now an activatable OneBots Application with the `legacy` stage. It publishes connection metadata, limitations, and the `get_pepperbot_application_info` compatibility action for matching `onebot.v11` protocol instances.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t pepperbot -c config.yaml
```

Or persist the selection:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [pepperbot]
```

## Runtime capability

| Item | Current value |
| --- | --- |
| Application | `pepperbot` |
| Stage | `legacy` |
| Protocol | `onebot.v11` |
| Transport | `websocket` |
| Extension action | `get_pepperbot_application_info` |
| Verification | `documented` |
| Upstream | [PepperBot](https://github.com/SSmJaE/PepperBot) |

Use `GET /api/applications` to inspect effective per-account protocol capabilities. Generate a redacted connection template with:

```bash
onebots frameworks --framework pepperbot --account <platform.account_id>
```

## Boundaries

This target exists for existing PepperBot migrations; new projects should use a modern framework with ongoing verification.

This stage can be activated with `-t`, but it is not recommended for new deployments.
