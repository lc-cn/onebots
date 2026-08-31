# General Configuration

General configuration defines default settings for all protocols, which can be overridden at the account level.

## Configuration Structure

```yaml
general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  satori.v1:
    use_http: true
    use_ws: true
    token: ''
  milky.v1:
    use_http: true
    use_ws: true
    token: ''
```

## Protocol Configurations

- [OneBot V11 Configuration](/en/config/protocol/onebot-v11)
- [OneBot V12 Configuration](/en/config/protocol/onebot-v12)
- [Satori Configuration](/en/config/protocol/satori-v1)
- [Milky Configuration](/en/config/protocol/milky-v1)

## Related Links

- [Global Configuration](/en/config/global)
- [Protocol Configuration](/en/config/protocol)

