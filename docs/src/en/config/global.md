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

Before connecting to a platform or starting protocol transports, OneBots validates the complete configuration against the schemas registered by plugins loaded with `-r` and `-p`. This covers required platform credentials, field types and choices, adapter and protocol references, and the effective protocol configuration after account values inherit from `general`.

Errors include a complete path such as `qq.my_bot.appid` or `qq.my_bot.onebot.v11.use_http`. Referencing an unloaded adapter or protocol also stops startup instead of silently omitting the account. The Web console save and hot-reload paths use the same validator, so invalid content is not written to the configuration file.

Run the same check before deployment with the service's plugin selection:

```bash
onebots doctor -c config.yaml -r qq -p onebot-v11 --json
```

When the service was installed with `onebots install`, doctor reads the saved plugin list from the service definition.
