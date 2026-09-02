# Overflow

Overflow is now an activatable OneBots Application with the `experimental` stage. It publishes connection metadata, limitations, and the `get_overflow_application_info` compatibility action for matching `onebot.v11` protocol instances.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t overflow -c config.yaml
```

Or persist the selection:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [overflow]
```

## Runtime capability

| Item | Current value |
| --- | --- |
| Application | `overflow` |
| Stage | `experimental` |
| Protocol | `onebot.v11` |
| Transport | `websocket` |
| Extension action | `get_overflow_application_info` |
| Verification | `documented` |
| Upstream | [Overflow](https://github.com/MrXiaoM/Overflow) |

Use `GET /api/applications` to inspect effective per-account protocol capabilities. Generate a redacted connection template with:

```bash
onebots frameworks --framework overflow --account <platform.account_id>
```

## Boundaries

Standard OneBot 11 messages and actions can connect; Mirai internals and MiraiCode are outside the compatibility promise.

This stage can be activated with `-t`, but it will not become `available` until pinned-version interoperability passes.
