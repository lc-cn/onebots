# Avilla

Avilla is now an activatable OneBots Application with the `experimental` stage. It publishes connection metadata, limitations, and the `get_avilla_application_info` compatibility action for matching `satori.v1` protocol instances.

## Start

```bash
onebots -r <adapter> -p satori-v1 -t avilla -c config.yaml
```

Or persist the selection:

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [satori-v1]
  applications: [avilla]
```

## Runtime capability

| Item | Current value |
| --- | --- |
| Application | `avilla` |
| Stage | `experimental` |
| Protocol | `satori.v1` |
| Transport | `websocket` |
| Extension action | `get_avilla_application_info` |
| Verification | `documented` |
| Upstream | [Avilla](https://github.com/GraiaProject/Avilla) |

Use `GET /api/applications` to inspect effective per-account protocol capabilities. Generate a redacted connection template with:

```bash
onebots frameworks --framework avilla --account <platform.account_id>
```

## Boundaries

Upstream still marks its Satori component as WIP; this template is for experiments only.

This stage can be activated with `-t`, but it will not become `available` until pinned-version interoperability passes.
