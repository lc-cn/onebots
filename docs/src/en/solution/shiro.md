# Shiro

Shiro is now an activatable OneBots Application with the `experimental` stage. It publishes connection metadata, limitations, and the `get_shiro_application_info` compatibility action for matching `onebot.v11` protocol instances.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t shiro -c config.yaml
```

Or persist the selection:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [shiro]
```

## Runtime capability

| Item | Current value |
| --- | --- |
| Application | `shiro` |
| Stage | `experimental` |
| Protocol | `onebot.v11` |
| Transport | `websocket` |
| Extension action | `get_shiro_application_info` |
| Verification | `documented` |
| Upstream | [Shiro](https://github.com/MisakaTAT/Shiro) |

Use `GET /api/applications` to inspect effective per-account protocol capabilities. Generate a redacted connection template with:

```bash
onebots frameworks --framework shiro --account <platform.account_id>
```

## Boundaries

No Spring Boot starter version is pinned yet; the current gate covers protocol identity, connection metadata, and compatibility actions.

This stage can be activated with `-t`, but it will not become `available` until pinned-version interoperability passes.
