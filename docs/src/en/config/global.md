# Global Configuration

Global configuration is the top-level configuration in `config.yaml`, which applies to the entire onebots service.

## Configuration Structure

```yaml
# Global configuration
port: 6727              # HTTP server port
log_level: info         # Log level: trace, debug, info, warn, error
timeout: 30             # Account and protocol startup timeout (seconds)
access_token: "replace-with-a-long-random-token" # Management token (sensitive)

# Plugins loaded when -r / -p are omitted
plugins:
  adapters: [qq]
  protocols: [onebot-v11]

# General configuration (protocol default configuration)
general:
  onebot.v11:
    # OneBot V11 default configuration
  onebot.v12:
    # OneBot V12 default configuration
  satori.v1:
    # Satori default configuration
  milky.v1:
    # Milky default configuration

# Account configuration
{platform}.{account_id}:
  # Account-specific configuration
```

## Global Configuration Fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `port` | number | HTTP server port | `6727` |
| `log_level` | string | Log level: `trace`, `debug`, `info`, `warn`, `error` | `info` |
| `timeout` | number | Global protection window for account login listeners and protocol outlets. An adapter may raise the window for a legitimate long login flow, but cannot shorten this value; WeChat ClawBot defaults to 480 seconds. On timeout OneBots aborts the signal passed to extensions, marks a starting protocol as failed, and continues with other accounts. | `30` |
| `database` | non-empty string | SQLite file; relative paths resolve below the `data` directory, absolute paths remain unchanged, and a missing `.db` suffix is appended; requires restart | `onebots.db` |
| `access_token` | string | Bearer token for the Web console, management API, and root management WebSocket | generated when no complete credentials exist |
| `username` / `password` | string | Alternative Web console credentials; both fields must be configured together | none |

`ONEBOTS_ACCESS_TOKEN` is a deployment-level override for the file-based `access_token`. It is intended for containers and hosted platforms where the configuration file cannot be read directly. While it is set, setup and the runtime do not generate a competing file token, and the environment value is never written to the configuration or logs. Restart the process after rotating it. Without this override, setup and the runtime generate a random 256-bit `access_token` when neither a token nor a complete username/password pair exists; that token is stored in the restricted configuration file and never printed to service logs.

`onebots doctor` validates the resolved database file and the directory SQLite needs for journal or WAL files. This covers absolute and escaping relative paths instead of assuming every database remains below the default data directory.

Account summaries returned by the management API and bot cards in the Web console expose the effective `startupTimeoutSeconds`, so operators can verify the actual boundary before startup.

## General Configuration

The `general` section defines default configurations for all protocols. These defaults can be overridden at the account level.

See [General Configuration](/en/config/general) for details.

## Account Configuration

Account configuration follows the format: `{platform}.{account_id}`.

See [Platform Configuration](/en/config/platform) for platform-specific configuration.

## Related Links

- [General Configuration](/en/config/general)
- [Platform Configuration](/en/config/platform)
- [Protocol Configuration](/en/config/protocol)

## Preflight validation

`plugins.adapters` and `plugins.protocols` contain the runtime plugin defaults persisted by setup. Both are arrays of plugin short names, and legacy configurations without `plugins` remain valid. Explicit options override one category at a time: `-r qq` replaces `plugins.adapters` while still reusing `plugins.protocols`.

The Web console presents plugins that completed entry loading and registration contract validation in the current process as addable suggestions. A free-form input remains available for third-party short names or full package names. Suggestions are runtime evidence rather than a closed allowlist; custom entries still go through normal package resolution and registration checks on the next startup or doctor run.

The Web console can save a plugin selection, but a running process cannot safely unload or replace plugins, so the change is reported as requiring a restart. An installed service uses the plugin list saved in its service definition. After editing `plugins`, run `onebots install -c config.yaml` again to update that definition before starting or restarting the service.

Before connecting to a platform or starting protocol transports, OneBots validates the complete configuration against the schemas registered by the selected plugins. This covers required platform credentials, field types and choices, adapter and protocol references, at least one loaded protocol outlet per account, and the effective protocol configuration after account values inherit from `general`.

Errors identify the complete path, such as `qq.my_bot.appid` or `qq.my_bot.onebot.v11.use_http`; a missing outlet identifies the account path itself, such as `qq.my_bot`. Referencing an unloaded adapter or protocol also stops startup instead of silently omitting the account. The Web console, setup, doctor, and hot reload use the same validator, so invalid content is not written to the configuration file.

**Save and apply** in the Web console atomically saves the file and then hot reloads accounts and protocols. If runtime application fails, both the file and runtime return to the previous configuration. Host settings such as the port, path, and database remain saved and the response lists which fields require a restart. A concurrent save or reload returns HTTP 409 without overwriting the configuration being applied.

Integrations that still use the root management WebSocket must authenticate the handshake with `Authorization: Bearer <token>` or `?access_token=<token>`; unauthorized requests receive HTTP 401 before upgrade. After connecting, they may send `{ "action": "system.saveConfig", "data": "...", "echo": "request-id" }` or `system.reload`. Both actions use the same transaction and concurrency lock and return `{ "event": "system.config.result", "echo": "request-id", "data": ... }`. Failure codes are `CONFIG_INVALID`, `CONFIG_CONFLICT`, and `CONFIG_APPLY_FAILED`. `system.reload` only reapplies the file from disk; it neither rewrites the file nor creates a backup.

Run the same check before deployment with the service's plugin selection:

```bash
onebots doctor -c config.yaml --json --strict
```

Default mode keeps recoverable first-run states, such as no configured account, no installed or running service, or an unavailable authenticated management probe, as warnings. With `--strict`, any warning sets JSON `ok` to `false` and returns exit code `1`, which is suitable for a production deployment gate. For a legacy configuration without `plugins`, pass `-r` and `-p` as before. Doctor prefers the saved service definition when `-c` is omitted or resolves to that service's configuration. Passing a different `-c` creates a standalone diagnostic scope: doctor uses that file's `plugins` and does not read, mark stale, or repair the unrelated service definition with `--fix`. The `plugin-selection` check reports the final plugins, source, and resolution directory for each category, with the same evidence preserved in JSON output. It passes only when both an adapter and a protocol have been selected. An adapter-only deployment warns that accounts have no outward protocol, while a protocol-only deployment warns that no platform account can be created; strict mode rejects either incomplete selection.
