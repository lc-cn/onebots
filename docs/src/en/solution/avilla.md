# Avilla

## API compatibility

- Protocol: `satori.v1`
- Transport: `websocket` (the framework connects to OneBots)
- The Application does not invent framework-specific actions. Standard actions stay in the protocol; platform-specific actions are forwarded only when the selected Adapter exposes them.
- `-t avilla` loads compatibility behavior only. It does not enable a transport or edit account configuration.

## Generate both configurations

```bash
onebots frameworks --framework avilla --account <platform.account_id>
```

For separate hosts, add `--origin http://<onebots-host>:6727`. The output contains the exact OneBots YAML, Avilla configuration, endpoint, and checks.

## Configure OneBots

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [satori-v1]
  applications: [avilla]

<platform>.<account_id>:
  account_id: <account_id>
  # Add the Adapter credentials documented for the platform.
  satori.v1:
    use_http: true
    use_ws: true
    token: <shared-token>
```

```bash
onebots -r <adapter> -p satori-v1 -t avilla -c config.yaml
```

Copy the generated “Avilla configuration” into the framework project. Keep the protocol, endpoint, and token identical on both sides. In containers, use a reachable service name instead of `127.0.0.1` for another container.

## Verify and repair

```bash
onebots doctor -c config.yaml
onebots frameworks --framework avilla --account <platform.account_id>
```

| Symptom | Fix |
| --- | --- |
| plugin load failure | Install the named package and check the `-r/-p/-t` names |
| refused connection / 404 | Fix host, port, account path; for forward WS explicitly set `use_ws: true` |
| reverse WS absent | Start the framework listener first and correct `ws_reverse_url` |
| 401 | Make both tokens identical and remove stale environment overrides |
| `Unknown action` | Check required/missing actions and Adapter capabilities; disable the dependent plugin or implement a real Application conversion |
| connected without events | Repair account login, platform subscriptions/permissions, and event filters |

See the [framework troubleshooting guide](/en/solution/troubleshooting) for command-level diagnosis.
