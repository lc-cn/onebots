# NoneBot 1

NoneBot 1 is now an activatable OneBots Application with the `legacy` stage. It publishes connection metadata, limitations, and the `get_nonebot1_application_info` compatibility action for matching `onebot.v11` protocol instances.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t nonebot1 -c config.yaml
```

Or persist the selection:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [nonebot1]
```

## Runtime capability

| Item | Current value |
| --- | --- |
| Application | `nonebot1` |
| Stage | `legacy` |
| Protocol | `onebot.v11` |
| Transport | `reverse-websocket` |
| Extension action | `get_nonebot1_application_info` |
| Verification | `documented` |
| Upstream | [NoneBot 1](https://github.com/nonebot/nonebot) |

Use `GET /api/applications` to inspect effective per-account protocol capabilities. Generate a redacted connection template with:

```bash
onebots frameworks --framework nonebot1 --account <platform.account_id>
```

## Boundaries

This target is only for existing NoneBot 1 / aiocqhttp projects. Operators own Python and dependency compatibility; new projects should use NoneBot2.

This stage can be activated with `-t`, but it is not recommended for new deployments.
