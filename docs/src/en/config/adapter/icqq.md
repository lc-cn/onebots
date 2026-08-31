# ICQQ Adapter Configuration

ICQQ adapter configuration reference.

## Configuration Options

### password

- **Type**: `string`
- **Required**: ❌
- **Description**: QQ password, QR code login if not provided

### protocol

Protocol configuration object.

#### protocol.platform

- **Type**: `number`
- **Default**: `2`
- **Description**: Login platform

| Value | Platform |
|-------|----------|
| 1 | Android Phone |
| 2 | Android Pad (Recommended) |
| 3 | Android Watch |
| 4 | MacOS |
| 5 | iPad |
| 6 | Tim |

#### protocol.ver

- **Type**: `string`
- **Required**: ❌
- **Description**: Login Apk version

#### protocol.sign_api_addr

- **Type**: `string`
- **Required**: ❌ (Strongly recommended)
- **Description**: Sign server address. May fail to login or send/receive messages without it.

#### protocol.data_dir

- **Type**: `string`
- **Default**: `path.join(process.cwd(), "data")`
- **Description**: Data storage directory

#### protocol.log_config

- **Type**: `object`
- **Required**: ❌
- **Description**: [log4js Configuration](https://log4js-node.github.io/log4js-node/api.html)

#### protocol.ignore_self

- **Type**: `boolean`
- **Default**: `true`
- **Description**: Filter self messages in group chats and channels

#### protocol.resend

- **Type**: `boolean`
- **Default**: `true`
- **Description**: Try to send in fragments when rate limited

#### protocol.reconn_interval

- **Type**: `number`
- **Default**: `5`
- **Unit**: seconds
- **Description**: Reconnection interval after `system.offline.network` event

#### protocol.cache_group_member

- **Type**: `boolean`
- **Default**: `true`
- **Description**: Whether to cache group member list

#### protocol.auto_server

- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically select the best server

#### protocol.ffmpeg_path

- **Type**: `string`
- **Required**: ❌
- **Description**: ffmpeg path, requires ffmpeg installation

#### protocol.ffprobe_path

- **Type**: `string`
- **Required**: ❌
- **Description**: ffprobe path, requires ffmpeg installation

## Configuration Examples

### QR Code Login

```yaml
icqq.123456789:
  protocol:
    platform: 2
    sign_api_addr: 'http://127.0.0.1:8080'
```

### Password Login

```yaml
icqq.123456789:
  password: 'your_password'
  protocol:
    platform: 2
    sign_api_addr: 'http://127.0.0.1:8080'
    data_dir: './data/icqq'
    ignore_self: true
    resend: true
    reconn_interval: 5
    cache_group_member: true
    auto_server: true
```

## Sign Server

::: warning Important
ICQQ protocol requires a sign server for login and messaging.
:::

Sign server deployment reference:
- [unidbg-fetch-qsign](https://github.com/fuqiuluo/unidbg-fetch-qsign)

## Related Links

- [Adapter Configuration Guide](/en/guide/adapter)
- [ICQQ Platform Documentation](/en/platform/icqq)
