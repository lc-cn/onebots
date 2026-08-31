# OneBot V12 Protocol

OneBot V12 is the next generation version of the OneBot protocol, providing a more modern and flexible robot interface standard.

## Protocol Introduction

OneBot V12 improvements over V11:

- More standardized message segment format (replacing CQ Code)
- More complete type system
- Cross-platform feature support
- Better extensibility
- Standardized error handling

## Standard Reference

- Official Repository: https://github.com/botuniverse/onebot
- Official Documentation: https://12.onebot.dev

## Documentation Navigation

- [Actions (Action)](/en/protocol/onebot-v12/action) - API interface documentation
- [Events (Event)](/en/protocol/onebot-v12/event) - Event type documentation
- [Message Segments (Segment)](/en/protocol/onebot-v12/segment) - Message segment format documentation

## Installation

```bash
npm install @onebots/protocol-onebot-v12
```

## Configuration

Configure OneBot V12 protocol in `config.yaml`:

```yaml
# Global default configuration
general:
  onebot.v12:
    use_http: true        # Enable HTTP API
    use_ws: false         # Enable WebSocket
    use_ws_reverse: false # Enable reverse WebSocket

# Account configuration
wechat.my_mp:
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: "your_token"
```

## Communication Methods

### HTTP API

**URL Format**: `http://localhost:6727/{platform}/{account_id}/onebot/v12/{action}`

**Example**:
```bash
# Send message
curl -X POST http://localhost:6727/wechat/my_mp/onebot/v12/send_message \
  -H "Content-Type: application/json" \
  -d '{
    "detail_type": "private",
    "user_id": "123456",
    "message": [
      {"type": "text", "data": {"text": "Hello"}}
    ]
  }'
```

### WebSocket

**URL Format**: `ws://localhost:6727/{platform}/{account_id}/onebot/v12`

### Reverse WebSocket

```yaml
wechat.my_mp:
  onebot.v12:
    use_ws_reverse: true
    ws_reverse_url: "ws://your-server:8080/ws"
```

## Message Format

OneBot V12 uses a unified message segment array format:

```json
[
  {
    "type": "text",
    "data": {"text": "Hello "}
  },
  {
    "type": "at",
    "data": {"user_id": "123456"}
  }
]
```

## Client SDK Usage

```typescript
import { ImHelper } from 'imhelper';
import { OneBotV12Adapter } from '@imhelper/onebot-v12';

const client = new ImHelper();

// Register OneBot V12 protocol adapter
client.registerAdapter('onebot.v12', OneBotV12Adapter);

// Connect to onebots server
await client.connect({
  platform: 'wechat',
  account_id: 'my_mp',
  protocol: 'onebot.v12',
  endpoint: 'ws://localhost:6727/wechat/my_mp/onebot/v12/ws',
  access_token: 'your_access_token',
});
```

## Related Links

- [OneBot V12 Configuration](/en/config/protocol/onebot-v12)
- [Actions Documentation](/en/protocol/onebot-v12/action)
- [Events Documentation](/en/protocol/onebot-v12/event)
- [Message Segments Documentation](/en/protocol/onebot-v12/segment)

