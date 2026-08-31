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

