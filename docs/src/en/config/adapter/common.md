# Common Adapter Configuration

Common configuration fields shared by all adapters.

## Account ID Format

All adapters use the format `{platform}.{account_id}` for account configuration:

```yaml
{platform}.{account_id}:
  # Platform-specific configuration
  # Protocol configuration
```

## Protocol Configuration

All adapters support protocol configuration:

```yaml
{platform}.{account_id}:
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
  onebot.v12:
    access_token: 'your_v12_token'
  satori.v1:
    token: 'your_satori_token'
  milky.v1:
    access_token: 'your_milky_token'
```

## Related Links

- [Global Configuration](/en/config/global)
- [Protocol Configuration](/en/config/protocol)

