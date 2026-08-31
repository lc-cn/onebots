# Global Configuration

Global configuration is the top-level configuration in `config.yaml`, which applies to the entire onebots service.

## Configuration Structure

```yaml
# Global configuration
port: 6727              # HTTP server port
log_level: info         # Log level: trace, debug, info, warn, error
timeout: 30             # Login timeout (seconds)

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
| `timeout` | number | Login timeout in seconds | `30` |

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

Before connecting to a platform or starting protocol transports, OneBots validates the complete configuration against the schemas registered by plugins loaded with `-r` and `-p`. This covers required platform credentials, field types and choices, adapter and protocol references, at least one loaded protocol outlet per account, and the effective protocol configuration after account values inherit from `general`.

Errors identify the complete path, such as `qq.my_bot.appid` or `qq.my_bot.onebot.v11.use_http`; a missing outlet identifies the account path itself, such as `qq.my_bot`. Referencing an unloaded adapter or protocol also stops startup instead of silently omitting the account. The Web console, setup, doctor, and hot reload use the same validator, so invalid content is not written to the configuration file.

**Save and apply** in the Web console atomically saves the file and then hot reloads accounts and protocols. If runtime application fails, both the file and runtime return to the previous configuration. Host settings such as the port, path, and database remain saved and the response lists which fields require a restart. A concurrent save or reload returns HTTP 409 without overwriting the configuration being applied.

Integrations that still use the root management WebSocket must authenticate the handshake with `Authorization: Bearer <token>` or `?access_token=<token>`; unauthorized requests receive HTTP 401 before upgrade. After connecting, they may send `{ "action": "system.saveConfig", "data": "...", "echo": "request-id" }` or `system.reload`. Both actions use the same transaction and concurrency lock and return `{ "event": "system.config.result", "echo": "request-id", "data": ... }`. Failure codes are `CONFIG_INVALID`, `CONFIG_CONFLICT`, and `CONFIG_APPLY_FAILED`. `system.reload` only reapplies the file from disk; it neither rewrites the file nor creates a backup.

Run the same check before deployment with the service's plugin selection:

```bash
onebots doctor -c config.yaml -r qq -p onebot-v11 --json
```

When the service was installed with `onebots install`, doctor reads the saved plugin list from the service definition.
