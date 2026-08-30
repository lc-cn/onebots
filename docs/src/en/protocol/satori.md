# Satori Protocol

Satori is a modern, unified robot protocol standard designed for cross-platform robot applications.

## Protocol Introduction

Satori protocol provides:

- Unified message format
- Standardized API interface
- Event-driven architecture
- Multi-platform support
- Extensible design

## Standard Reference

- Official Repository: https://github.com/satorijs/satori
- Official Documentation: https://satori.js.org

## Installation

### Server-Side

```bash
npm install @onebots/protocol-satori-v1
```

### Client-Side

```bash
npm install @imhelper/satori-v1
```

## Configuration

Configure Satori protocol in `config.yaml`:

```yaml
# Global default configuration
general:
  satori.v1:
    use_http: true
    use_ws: true
    token: ''

# Account configuration
wechat.my_mp:
  satori.v1:
    use_http: true
    use_ws: true
    token: 'your_token'
```

## Communication Methods

### HTTP API

**URL Format**: `http://localhost:6727/{platform}/{account_id}/satori/v1/{resource}.{method}`

### WebSocket

**URL Format**: `ws://localhost:6727/{platform}/{account_id}/satori/v1`

## Client SDK Usage

```typescript
import { createSatoriClient } from '@imhelper/satori-v1';

const client = createSatoriClient({
  baseUrl: 'http://localhost:6727/discord/my-bot/satori/v1',
  apiBaseUrl: 'http://localhost:6727/discord/my-bot/satori/v1',
  wsUrl: 'ws://localhost:6727/discord/my-bot/satori/v1/events',
  selfId: 'my-bot',
  platform: 'discord',
  accessToken: 'your-token',
  receiveMode: 'ws',
});

client.on('message.channel', async message => message.reply('Received!'));
await client.start();
```

## Related Links

- [Satori Configuration](/en/config/protocol/satori-v1)
- [Quick Start](/en/guide/start)
- [Client SDK Guide](/en/guide/client-sdk)
