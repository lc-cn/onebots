# Protocol Configuration

Protocol configuration is used to set parameters for protocol interfaces provided by onebots. Default values can be set in `general`, or configured individually at the account level.

## Configuration Hierarchy

```yaml
# 1. Global default (general)
general:
  {protocol}.{version}:
    param: value

# 2. Account level (overrides general)
{platform}.{account_id}:
  {protocol}.{version}:
    param: value
```

## Supported Protocols

- `onebot.v11` - OneBot V11 Protocol
- `onebot.v12` - OneBot V12 Protocol
- `satori.v1` - Satori Protocol
- `milky.v1` - Milky Protocol

## OneBot V11

### Communication Method Configuration

```yaml
onebot.v11:
  use_http: true              # HTTP API
  use_ws: false               # Forward WebSocket
  use_ws_reverse: false       # Reverse WebSocket
```

### HTTP API

When enabled, provides HTTP POST interface for API calls.

**Access URL**: `http://localhost:6727/{platform}/{account_id}/onebot/v11/{action}`

**Configuration**:
```yaml
onebot.v11:
  use_http: true
  access_token: your_token    # Optional, API authentication
  post_timeout: 5000          # Request timeout (milliseconds)
```

### Forward WebSocket

Client actively connects to onebots.

**Access URL**: `ws://localhost:6727/{platform}/{account_id}/onebot/v11`

**Configuration**:
```yaml
onebot.v11:
  use_ws: true
  access_token: your_token    # Optional, connection authentication
```

### Reverse WebSocket

onebots actively connects to specified server.

**Configuration**:
```yaml
onebot.v11:
  use_ws_reverse: true
  ws_reverse_url: ws://localhost:8080/ws           # Connection URL
  ws_reverse_api_url: ws://localhost:8080/api      # API-specific URL (optional)
  ws_reverse_event_url: ws://localhost:8080/event  # Event-specific URL (optional)
  access_token: your_token                         # Optional, authentication
  ws_reverse_reconnect_interval: 3000              # Reconnection interval (milliseconds)
```

## OneBot V12

Similar to OneBot V11, but with updated message format and API structure.

**Access URL**: `http://localhost:6727/{platform}/{account_id}/onebot/v12/{action}`

## Satori Protocol

**Access URL**: `http://localhost:6727/{platform}/{account_id}/satori/v1/{action}`

## Milky Protocol

**Access URL**: `http://localhost:6727/{platform}/{account_id}/milky/v1/{action}`

## Related Links

- [OneBot V11 Configuration](/en/config/protocol/onebot-v11)
- [OneBot V12 Configuration](/en/config/protocol/onebot-v12)
- [Satori Configuration](/en/config/protocol/satori-v1)
- [Milky Configuration](/en/config/protocol/milky-v1)
- [Global Configuration](/en/config/global)
- [General Configuration](/en/config/general)

