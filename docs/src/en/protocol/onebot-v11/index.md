# OneBot V11 Protocol

OneBot V11 is a widely used chatbot application interface standard supported by many robot frameworks.

## Protocol Introduction

OneBot V11 (formerly CQHTTP) is one of the most popular robot protocol standards, providing:

- Unified message format (CQ Code)
- Complete API interface
- Event push mechanism
- HTTP and WebSocket communication methods

## Standard Reference

- Official Repository: https://github.com/botuniverse/onebot-v11
- Official Documentation: https://11.onebot.dev

## Documentation Navigation

- [Actions (Action)](/en/protocol/onebot-v11/action) - API interface documentation
- [Events (Event)](/en/protocol/onebot-v11/event) - Event type documentation
- [CQ Code (CQ Code)](/en/protocol/onebot-v11/cqcode) - Message segment format documentation

## Installation

```bash
npm install @onebots/protocol-onebot-v11
```

## Configuration

Configure OneBot V11 protocol in `config.yaml`:

```yaml
# Global default configuration
general:
  onebot.v11:
    use_http: true        # Enable HTTP API
    use_ws: false         # Enable WebSocket
    use_ws_reverse: false # Enable reverse WebSocket
    
# Account configuration
wechat.my_mp:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: "your_token"  # API access token (optional)
```

## Communication Methods

### HTTP API

**URL Format**: `http://localhost:6727/{platform}/{account_id}/onebot/v11/{action}`

**Example**:
```bash
# Send private message
curl -X POST http://localhost:6727/wechat/my_mp/onebot/v11/send_private_msg \
  -H "Content-Type: application/json" \
  -d '{"user_id": "123456", "message": "Hello"}'
```

### WebSocket

**URL Format**: `ws://localhost:6727/{platform}/{account_id}/onebot/v11`

After connecting, clients can receive event pushes and call APIs via WebSocket.

### Reverse WebSocket

onebots actively connects to the specified WebSocket server.

Configuration example:
```yaml
wechat.my_mp:
  onebot.v11:
    use_ws_reverse: true
    ws_reverse_url: "ws://your-server:8080/ws"
```

## Message Format

Supports two message formats:

- **String Format (CQ Code)**: `[CQ:type,param1=value1,param2=value2]`
- **Array Format**: `[{type: "type", data: {param1: "value1"}}]`

## Client SDK Usage

```typescript
import { ImHelper } from 'imhelper';
import { OneBotV11Adapter } from '@imhelper/onebot-v11';

const client = new ImHelper();

// Register OneBot V11 protocol adapter
client.registerAdapter('onebot.v11', OneBotV11Adapter);

// Connect to onebots server
await client.connect({
  platform: 'wechat',
  account_id: 'my_mp',
  protocol: 'onebot.v11',
  endpoint: 'ws://localhost:6727/wechat/my_mp/onebot/v11/ws',
  access_token: 'your_access_token',
});
```

## Related Links

- [OneBot V11 Configuration](/en/config/protocol/onebot-v11)
- [Actions Documentation](/en/protocol/onebot-v11/action)
- [Events Documentation](/en/protocol/onebot-v11/event)
- [CQ Code Documentation](/en/protocol/onebot-v11/cqcode)

