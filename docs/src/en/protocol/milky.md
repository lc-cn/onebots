# Milky Protocol

Milky is a lightweight robot protocol standard designed for simple and efficient robot applications.

## Protocol Introduction

Milky protocol provides:

- Lightweight message format
- Simple API interface
- Efficient communication
- Easy to implement

## Installation

### Server-Side

```bash
npm install @onebots/protocol-milky-v1
```

### Client-Side

```bash
npm install @imhelper/milky-v1
```

## Configuration

Configure Milky protocol in `config.yaml`:

```yaml
# Global default configuration
general:
  milky.v1:
    use_http: true
    use_ws: true
    token: ''

# Account configuration
wechat.my_mp:
  milky.v1:
    use_http: true
    use_ws: true
    token: 'your_token'
```

## Communication Methods

### HTTP API

**URL Format**: `http://localhost:6727/{platform}/{account_id}/milky/v1/{action}`

### WebSocket

**URL Format**: `ws://localhost:6727/{platform}/{account_id}/milky/v1`

## Client SDK Usage

```typescript
import { ImHelper } from 'imhelper';
import { MilkyV1Adapter } from '@imhelper/milky-v1';

const client = new ImHelper();

// Register Milky protocol adapter
client.registerAdapter('milky.v1', MilkyV1Adapter);

// Connect to onebots server
await client.connect({
  platform: 'wechat',
  account_id: 'my_mp',
  protocol: 'milky.v1',
  endpoint: 'ws://localhost:6727/wechat/my_mp/milky/v1/ws',
  token: 'your_token',
});
```

## Related Links

- [Milky Configuration](/en/config/protocol/milky-v1)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)

