# Client SDK

The `imhelper` client SDK provides a unified interface for connecting to onebots servers and developing cross-protocol robot applications.

## Introduction

`imhelper` is the client SDK for onebots, providing:

- **Unified Interface**: Same API regardless of protocol (OneBot V11/V12, Satori, Milky)
- **Multiple Receivers**: Support WebSocket, Webhook, and SSE receiving methods
- **Message Conversion**: Automatically converts protocol-specific messages to unified format
- **Type Safety**: Full TypeScript support

## Installation

```bash
npm install imhelper
# or
pnpm add imhelper
```

## Quick Start

```typescript
import { ImHelper } from 'imhelper';

// Create ImHelper instance
const helper = new ImHelper({
  baseUrl: 'http://localhost:6727',
  platform: 'wechat',
  accountId: 'my_wechat_mp',
  accessToken: 'your_access_token',
  protocol: 'onebot.v11',
});

// Listen for messages
helper.on('message', (message) => {
  console.log('Received message:', message.content);
  
  // Auto reply
  helper.sendMessage({
    scene_id: message.scene_id,
    scene_type: message.scene_type,
    message: [{ type: 'text', data: { text: 'Received!' } }],
  });
});

// Connect
await helper.connect();
```

## Receivers

### WebSocket Receiver

Real-time event reception via WebSocket:

```typescript
const helper = new ImHelper({
  // ... config
  receiver: 'websocket',
});
```

### Webhook Receiver

Receive events via HTTP webhook:

```typescript
const helper = new ImHelper({
  // ... config
  receiver: 'webhook',
  port: 8080, // Webhook server port
});
```

### SSE Receiver

Receive events via Server-Sent Events:

```typescript
const helper = new ImHelper({
  // ... config
  receiver: 'sse',
});
```

## API Reference

See [Client SDK Documentation](/en/guide/client-sdk) for complete API reference.

