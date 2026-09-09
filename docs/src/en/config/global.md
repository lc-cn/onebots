# Global configuration

The OneBots manager stores business configuration in a selected workspace. Web, TUI, and configuration commands share the same draft, validation, and apply flow. Do not bypass the manager to drive the gateway process directly.

## Workspace

Point every management command at the same persistent directory:

```bash
onebots serve --data-dir /path/to/onebots-data
onebots auth bootstrap --data-dir /path/to/onebots-data
onebots ui --data-dir /path/to/onebots-data
```

Persist the same directory when installing an operating-system service:

```bash
onebots install --data-dir /path/to/onebots-data
onebots start
```

## Configuration shape

A blank installation does not preselect accounts, protocols, or framework extensions:

```yaml
port: 6727
log_level: info
timeout: 30
database: onebots.db

plugins:
  adapters: []
  protocols: []
  applications: []

general: {}
```

Use Web or TUI to create an installation plan. After the extensions are installed, verified, and explicitly activated, add account settings:

```yaml
plugins:
  adapters: [qq]
  protocols: [onebot-v11]
  applications: []

general:
  onebot.v11:
    use_http: true
    access_token: replace-with-a-protocol-token

qq.my_bot:
  appid: replace-with-app-id
  secret: replace-with-app-secret
  onebot.v11:
    use_ws: true
```

Accounts use `{platform}.{account_id}` keys. Protocol fields on an account override defaults for the same protocol below `general`.

## Global fields

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `port` | `number` | `6727` | Gateway protocol transport port |
| `log_level` | `string` | `info` | `trace`, `debug`, `info`, `warn`, or `error` |
| `timeout` | `number` | `30` | Account and protocol startup protection window in seconds |
| `database` | non-empty `string` | `onebots.db` | SQLite file; relative paths resolve from the workspace |
| `plugins.adapters` | `string[]` | `[]` | Platform adapters in the active runtime version |
| `plugins.protocols` | `string[]` | `[]` | Output protocols in the active runtime version |
| `plugins.applications` | `string[]` | `[]` | Framework extensions in the active runtime version |

When `timeout` expires, OneBots aborts the signal passed to extensions, marks transports that are still starting as failed, and continues with other accounts. An adapter may declare a longer window for a legitimate long-running login flow.

Changing `database` requires a restart. `onebots doctor` checks the resolved file and the parent directory SQLite needs for journals or WAL files.

## Manager and protocol authentication

The manager only uses one-time pairing codes and revocable device sessions:

```bash
onebots auth bootstrap --data-dir /path/to/onebots-data
onebots auth device --data-dir /path/to/onebots-data
onebots auth recover --data-dir /path/to/onebots-data
```

Root `username`, `password`, and `access_token` values are no longer manager login settings. During migration, the manager excludes those fields from the gateway configuration snapshot.

Protocol `access_token`, `token`, and signing-secret fields remain business connection settings. For example, `general.onebot.v11.access_token` protects OneBot v11 APIs and transports and cannot log in to the Web console.

## Installation and apply boundaries

`plugins` records the extensions in the active runtime version. An installation plan resolves the package and peer dependencies, verifies the candidate artifacts, and waits for explicit activation. Installing an extension does not connect a platform or enable a protocol automatically.

Web and TUI apply configuration through the same transaction. An invalid draft cannot replace active configuration. If runtime application fails, both the file and the runtime return to the previous revision. Host fields such as the port and database explicitly report that a restart is required.

Before any platform connection, OneBots validates the complete configuration against schemas registered by the active extensions. Validation covers required platform credentials, field types, adapter and protocol references, account protocol outlets, and merged account and `general` values. Errors include the full path, such as `qq.my_bot.appid`.

## Pre-deployment check

```bash
onebots doctor --data-dir /path/to/onebots-data --json --strict
```

Default mode reports recoverable first-run states as warnings. With `--strict`, any warning produces a failing exit code for use as a deployment gate. Run `onebots migrate` for an old installation instead of using retired runtime flags to override the active version.

## Related documentation

- [Protocol configuration](/en/config/protocol)
- [Platform configuration](/en/config/platform)
- [Production deployment](/en/guide/production)
