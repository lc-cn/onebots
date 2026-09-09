# ICQQ Adapter

The ICQQ adapter is based on the `@icqqjs/icqq` library, supporting connection to onebots service by simulating the QQ client protocol.

## Status

✅ **Implemented and Available**

## Features

- ✅ **Message Sending/Receiving**
  - Private chat message sending/receiving
  - Group message sending/receiving
  - Supports text, emoji, images, voice, video, mentions, replies, and other message formats
- ✅ **Message Management**
  - Message recall
  - Get message history
- ✅ **Friend Management**
  - Get friend list
  - Handle friend requests
  - Delete friends
- ✅ **Group Management**
  - Get group list
  - Get group member list
  - Set group card
  - Kick group members
  - Mute group members / whole group mute
  - Set group admin
  - Leave / dismiss group
- ✅ **Event Support**
  - Private / group messages
  - Friend / group requests
  - Group member changes
  - Group mute / admin changes
  - Message recall
  - Poke
- ✅ **Login Methods**
  - QR code login
  - Password login

## Installation

`@icqqjs/icqq` is hosted on GitHub Packages. Prepare a GitHub token with `read:packages`, then open **Extensions** in the Web console and select ICQQ, or run:

```bash
onebots ui --data-dir <workspace> --setup
```

The installation flow requests the token only when it downloads the private dependency, then installs the ICQQ adapter and its required peer dependencies into a verified immutable runtime generation. The token is not written to the generation or logs. Do not configure `.npmrc`, run `npm login`, or install packages directly in the OneBots runtime directory.

## Configuration

Configure ICQQ account in `config.yaml`:

```yaml
# ICQQ bot account configuration
icqq.123456789:  # Your QQ number
  # Password login (optional, QR code login if not provided)
  password: 'your_password'
  
  # Protocol configuration
  protocol:
    platform: 2                    # Login platform
    sign_api_addr: 'http://127.0.0.1:8080'  # Sign server
    data_dir: './data/icqq'        # Data directory
    ignore_self: true              # Filter self messages
  
  # Protocol configuration
  onebot.v11:
    access_token: 'your_v11_token'
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `password` | string | No | QQ password, QR code login if not provided |
| `protocol.platform` | number | No | Login platform, default 2 |
| `protocol.sign_api_addr` | string | **Recommended** | Sign server address |
| `protocol.data_dir` | string | No | Data storage directory |
| `protocol.ignore_self` | boolean | No | Filter self messages, default true |

### Login Platforms

| Value | Platform |
|-------|----------|
| 1 | Android Phone |
| 2 | Android Pad (Recommended) |
| 3 | Android Watch |
| 4 | MacOS |
| 5 | iPad |
| 6 | Tim |

## Sign Server

::: warning Important
ICQQ protocol requires a sign server for login and messaging. Without a sign server, login may fail or messages may not be sent/received.
:::

Sign server deployment reference:
- [unidbg-fetch-qsign](https://github.com/fuqiuluo/unidbg-fetch-qsign)

Configuration example:

```yaml
protocol:
  sign_api_addr: 'http://127.0.0.1:8080'
```

## Client SDK Usage

Connect the client to the complete account protocol root, for example `http://localhost:6727/icqq/{account_id}/onebot/v11`. See the [Client SDK Guide](/en/guide/client-sdk) for Client creation, receive modes, existing-Host integration, and API calls.

## Important Notes

::: warning Account Safety
1. **Use a test account**: ICQQ is based on protocol reverse engineering, there's a risk of account suspension
2. **Sign server is required**: May fail to login without it
3. **Protocol updates**: QQ protocol may update anytime, update ICQQ and sign service if issues occur
4. **Data directory**: Configure an independent `data_dir` to avoid data conflicts
:::

## Related Links

- [ICQQ Adapter Configuration](/en/config/adapter/icqq)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)
