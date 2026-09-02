# GenshinUID

GenshinUID is now an activatable OneBots Application with the `experimental` stage. It publishes connection metadata, limitations, and the `get_genshinuid_application_info` compatibility action for matching `onebot.v11` protocol instances.

## Start

```bash
onebots -r <adapter> -p onebot-v11 -t genshinuid -c config.yaml
```

Or persist the selection:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [genshinuid]
```

## Runtime capability

| Item | Current value |
| --- | --- |
| Application | `genshinuid` |
| Stage | `experimental` |
| Protocol | `onebot.v11` |
| Transport | `reverse-websocket` |
| Extension action | `get_genshinuid_application_info` |
| Verification | `documented` |
| Upstream | [GenshinUID](https://github.com/KimigaiiWuyi/GenshinUID) |

Use `GET /api/applications` to inspect effective per-account protocol capabilities. Generate a redacted connection template with:

```bash
onebots frameworks --framework genshinuid --account <platform.account_id>
```

## Boundaries

GenshinUID v5 is a gsuid-core plugin and requires a supported host such as NoneBot2 or Yunzai; it is not a standalone OneBot client.

This stage can be activated with `-t`, but it will not become `available` until pinned-version interoperability passes.
