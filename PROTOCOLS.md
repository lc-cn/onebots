# Multi-Protocol Support

OneBots now supports multiple communication protocols, making it easy to integrate with different platforms and use cases.

## Supported Protocols

### 1. OneBot (v11, v12)
- **Description**: OneBot 是一个聊天机器人应用接口标准
- **Versions**: V11, V12
- **Reference**: https://onebot.dev/
- **Use Case**: QQ 机器人、通用聊天机器人
- **Implementation**: `src/protocols/onebot/`

### 2. Milky (v1)
- **Description**: Milky 是一个 QQ 机器人协议
- **Versions**: V1
- **Reference**: https://milky.ntqqrev.org/
- **Use Case**: QQ 机器人
- **Implementation**: `src/protocols/milky/`

### 3. Satori (v1)
- **Description**: Satori 是一个跨平台聊天机器人协议
- **Versions**: V1
- **Reference**: https://github.com/satorijs/satori
- **Use Case**: 跨平台聊天机器人（QQ、Discord、Telegram 等）
- **Implementation**: `src/protocols/satori/`

## URL Structure

Each protocol is accessible via a consistent URL pattern:

```
/{platform}/{uin}/{protocol}/{version}
```

### Examples:

**OneBot V11:**
```
http://127.0.0.1:6727/qq/123456789/onebot/v11/send_private_msg
ws://127.0.0.1:6727/qq/123456789/onebot/v11
```

**OneBot V12:**
```
http://127.0.0.1:6727/qq/123456789/onebot/v12/send_message
ws://127.0.0.1:6727/qq/123456789/onebot/v12
```

**Milky V1:**
```
http://127.0.0.1:6727/qq/123456789/milky/v1/send_message
ws://127.0.0.1:6727/qq/123456789/milky/v1
```

**Satori V1:**
```
http://127.0.0.1:6727/qq/123456789/satori/v1/message.create
ws://127.0.0.1:6727/qq/123456789/satori/v1
```

## Configuration

In your `config.yaml`, specify which protocols to enable for each bot:

```yaml
qq.123456789:
  versions:
    - version: V11
      protocol: onebot
    - version: V12
      protocol: onebot
    - version: v1
      protocol: milky
    - version: v1
      protocol: satori
  protocol:
    token: "your-token"
    secret: "your-secret"
```

## Protocol Features

### Common Event Flow

All protocols follow the same event flow:

```
Platform Event → Adapter.extractEvent() → CommonEvent → Protocol.dispatchCommonEvent() → Protocol-Specific Format
```

1. **Platform Event**: Raw event from platform (QQ, WeChat, etc.)
2. **Adapter**: Extracts platform-specific data into CommonEvent format
3. **CommonEvent**: Unified event structure shared across all protocols
4. **Protocol**: Converts CommonEvent to protocol-specific format and dispatches

### OneBot Protocol

OneBot provides comprehensive chatbot functionality:

**V11 Features:**
- Message sending/receiving (private, group, discuss)
- Friend/group management
- File operations
- Image/voice/video handling
- Event filtering

**V12 Features:**
- Enhanced message types
- Guild support
- File management
- Extended API methods
- Improved event structure

### Milky Protocol

Milky is designed for QQ bots with:
- Message handling
- Event notifications
- Request handling
- Similar to OneBot but with different message formats

**Current Status**: Basic implementation
**TODO**: 
- HTTP/WebSocket server implementation
- Complete action mapping
- Message format conversion

### Satori Protocol

Satori provides cross-platform support:

**Features:**
- Unified message format across platforms
- Element-based message content
- Channel/Guild support
- User management
- Platform-agnostic API

**Current Status**: Basic implementation
**TODO**:
- HTTP/WebSocket server implementation
- Complete action implementations
- Element parser integration

## Adding a New Protocol

To add a new protocol:

1. Create protocol directory: `src/protocols/yourprotocol/`

2. Implement protocol class extending `Protocol`:

```typescript
// src/protocols/yourprotocol/v1.ts
import { Protocol } from "../base";

export class YourProtocol extends Protocol<"v1", YourProtocol.Config> {
    public readonly name = "yourprotocol";
    public readonly version = "v1";
    
    // Implement required methods
    filterFn(event: Dict): boolean { ... }
    start(): void { ... }
    stop(): Promise<void> { ... }
    dispatch(event: any): void { ... }
    dispatchCommonEvent(commonEvent: CommonEvent.Event): void { ... }
    format(event: string, payload: any): any { ... }
    apply(action: string, params?: any): Promise<any> { ... }
}
```

3. Register the protocol:

```typescript
// src/protocols/yourprotocol/index.ts
import { ProtocolRegistry } from "../registry";
import { YourProtocol } from "./v1";

ProtocolRegistry.register("yourprotocol", "v1", YourProtocol, {
    displayName: "Your Protocol V1",
    description: "Description of your protocol",
    versions: ["v1"],
});

export * from "./v1";
```

4. Export from protocols index:

```typescript
// src/protocols/index.ts
export * from "./yourprotocol";
```

## Protocol Registry

Query available protocols at runtime:

```typescript
import { ProtocolRegistry } from "onebots";

// Get all protocol names
const protocols = ProtocolRegistry.getProtocolNames();
// => ["onebot", "milky", "satori"]

// Get versions for a protocol
const versions = ProtocolRegistry.getVersions("onebot");
// => ["v11", "v12"]

// Get protocol metadata
const metadata = ProtocolRegistry.getMetadata("satori");
// => { name: "satori", displayName: "Satori V1", ... }

// Check if protocol exists
const exists = ProtocolRegistry.has("milky", "v1");
// => true
```

## Development Status

| Protocol | Status | HTTP | WebSocket | Actions | Events |
|----------|--------|------|-----------|---------|--------|
| OneBot V11 | ✅ Complete | ✅ | ✅ | ✅ | ✅ |
| OneBot V12 | ✅ Complete | ✅ | ✅ | ✅ | ✅ |
| Milky V1 | 🚧 Basic | ⏳ TODO | ⏳ TODO | ⏳ TODO | ✅ |
| Satori V1 | 🚧 Basic | ⏳ TODO | ⏳ TODO | ⏳ Partial | ✅ |

## Next Steps

1. **Milky Protocol**:
   - Implement HTTP/WebSocket servers
   - Complete action mapping to adapter methods
   - Test with QQ platform

2. **Satori Protocol**:
   - Implement HTTP/WebSocket servers
   - Complete all Satori API methods
   - Add element parser for message content
   - Test cross-platform compatibility

3. **Documentation**:
   - Add API reference for each protocol
   - Provide usage examples
   - Create migration guides

## Contributing

To contribute to protocol implementations:

1. Follow the architecture pattern in `src/protocols/base.ts`
2. Use CommonEvent types for event handling
3. Map actions to adapter abstract methods
4. Add tests for your protocol
5. Update documentation

## References

- [OneBot Standard](https://onebot.dev/)
- [Milky Protocol](https://milky.ntqqrev.org/)
- [Satori Protocol](https://github.com/satorijs/satori)
- [Architecture Documentation](./ARCHITECTURE.md)
