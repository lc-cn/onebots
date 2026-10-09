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

Run `onebots extensions install --data-dir <workspace>` to open the complete dependency selection wizard. Before removing an extension, delete its accounts and protocol outlets from a configuration draft, remove it from the `plugins` selection, and apply that configuration. Then run `onebots extensions remove --adapter <name>`, `--protocol <name>`, or `--framework <name>`. Removal creates another complete immutable runtime version; it never deletes packages in the active directory. The dependency disappears from the active version only after the candidate is installed, verified, and explicitly activated. `--plan-only` only returns the plan.

Web, TUI, and CLI use the same configuration transaction. Invalid drafts cannot replace active configuration. A failed runtime apply attempts to restore only affected instances; the source file is restored only after rollback is confirmed. Unknown or incomplete results block subsequent application rather than assuming no platform action occurred.

### Account and protocol hot application

Validate first and review the server-generated impact summary. Adding, removing, or changing an account only affects that account; connection settings reconnect it. Adding, removing, or changing a protocol only replaces that protocol instance, preserving the platform connection and unrelated outlets. Changes to `general` affect only protocols whose effective merged configuration changes.

Hot application requires the extension to be installed, activated, and enabled in `plugins`. First enabling an unloaded extension also changes process-level selection and requires explicit restart approval. Subsequent accounts and outlets using that extension are hot-applied.

`log_level` and `timeout` update dynamically. An effectively unchanged configuration updates the configuration version without restarting resources. If the gateway is stopped, application only saves the configuration for the next start.

Replacing a protocol closes its own WS/SSE connections; its clients should reconnect. Unrelated connections remain running. Complete pending account login first. Active account operations are given a bounded drain window; inability to drain safely rejects the apply before closing connections.

Process-level settings such as database, listening configuration, and extension selection require explicit restart approval. The CLI requires `--allow-restart`; without approval the old configuration and gateway remain in place.

For a timeout or disconnect, query the original operation ID instead of applying again with a new ID. A confirmed late success or rollback can settle the original operation while its gateway remains available. Unknown receipts, externally changed files, and incomplete rollback keep the recovery protection active.

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
