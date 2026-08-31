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

### 1. Configure GitHub Packages Access

Since `@icqqjs/icqq` is a private package hosted on GitHub Packages, you need to configure access first.

Add to `.npmrc` in your project root:

```
@icqqjs:registry=https://npm.pkg.github.com
```

### 2. Login to GitHub Packages

```bash
npm login --scope=@icqqjs --auth-type=legacy --registry=https://npm.pkg.github.com
```

- **UserName**: Your GitHub username
- **Password**: Get from https://github.com/settings/tokens/new with `read:packages` scope
- **E-Mail**: Your public email address

### 3. Install Dependencies

```bash
npm install @onebots/adapter-icqq
# or
pnpm add @onebots/adapter-icqq
```

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

```typescript
import { ImHelper } from 'imhelper';
import { OneBotV11Adapter } from '@imhelper/onebot-v11';

const client = new ImHelper();

// Register OneBot V11 protocol adapter
client.registerAdapter('onebot.v11', OneBotV11Adapter);

// Connect to onebots server
await client.connect({
  platform: 'icqq',
  account_id: '123456789',  // Your QQ number
  protocol: 'onebot.v11',
  endpoint: 'ws://localhost:6727/icqq/123456789/onebot/v11/ws',
  access_token: 'your_access_token',
});
```

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

