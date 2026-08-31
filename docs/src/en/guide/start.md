# Quick Start

This guide will help you quickly deploy the onebots service.

## What is onebots?

onebots is a **multi-platform multi-protocol robot application framework** that provides complete server and client solutions:

- **Platform Layer**: Robot APIs from major platforms like WeChat, QQ, DingTalk, etc.
- **onebots (Server)**: Unified protocol conversion layer that converts platform APIs to standard protocols
- **Standard Protocols**: Standard protocol interfaces like OneBot V11/V12, Satori, Milky, etc.
- **imhelper (Client SDK)**: Unified client interface that smooths protocol differences
- **Framework Layer**: Robot application frameworks like Koishi, NoneBot, Yunzai, etc.

```
Platform APIs (WeChat, QQ, DingTalk...)
        ↓
    onebots (Server) ← This project's server
        ↓
Standard Protocols (OneBot, Satori...)
        ↓
    imhelper (Client SDK) ← This project's client
        ↓
Robot Frameworks (Koishi, NoneBot...)
```

**Use Cases**:
- **Server Scenario**: When you want to develop robots with frameworks like Koishi, but the platform doesn't directly support it, onebots server can act as a bridge
- **Client Scenario**: When you need to develop cross-protocol robot applications, imhelper provides a unified client interface without worrying about underlying protocol differences

## Prerequisites

- Node.js >= 22
- pnpm / npm / yarn (pnpm recommended)

## Installation

### Global Installation

```bash
npm install -g onebots
# or
pnpm add -g onebots
```

### Project Installation

```bash
npm install onebots
# or
pnpm add onebots
```

## How It Works

1. **Configure Platform Accounts**: Fill in platform robot authentication information in the configuration file
2. **Load Adapters**: onebots uses corresponding adapters to connect to platforms (e.g., WeChat adapter)
3. **Select Protocol**: Specify the protocol interface to provide (e.g., OneBot V11, Satori)
4. **Start Service**: onebots starts listening and converting messages
5. **Framework Integration**: Robot frameworks communicate with onebots through standard protocols

## Create Configuration File

Create a `config.yaml` file in the project root:

```yaml
# Global configuration
port: 6727              # HTTP server port
log_level: info         # Log level: trace, debug, info, warn, error
timeout: 30             # Login timeout (seconds)

# General configuration (protocol default configuration)
general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ''
    enable_cors: true
    heartbeat_interval: 5

# Account configuration
# Format: {platform}.{account_id}
wechat.my_wechat_mp:
  # Protocol configuration
  onebot.v11:
    use_http: true
    use_ws: true
  
  # WeChat platform configuration
  app_id: your_app_id
  app_secret: your_app_secret
  token: your_token
```

For complete configuration examples, see [Configuration Guide](/en/config/global).

## Start Service

### Docker (recommended for production)

If Docker is installed, you can run the image directly without Node.js on the host. See [Docker Deployment](/en/guide/docker).

```bash
# Using docker compose
docker compose up -d

# Or docker run
docker run -d -p 6727:6727 -v $(pwd)/data:/data onebots
```

### Method 1: Command Line (Recommended)

```bash
# Start with default configuration
onebots

# Start with custom configuration file
onebots -c config.yaml

# Register adapters
onebots -r wechat -r qq -r kook
```

### Method 2: Programmatic

```typescript
import { App } from 'onebots';

const app = new App({
  configPath: './config.yaml'
});

await app.start();
```

## Install Adapters

Before using a platform, you need to install the corresponding adapter:

```bash
# Install WeChat adapter
npm install @onebots/adapter-wechat

# Install QQ adapter
npm install @onebots/adapter-qq

# Install multiple adapters
npm install @onebots/adapter-wechat @onebots/adapter-qq @onebots/adapter-kook
```

For more adapter installation instructions, see [Adapter Guide](/en/guide/adapter).

## Next Steps

- 📖 Read the [Architecture Guide](/en/guide/architecture) to understand the system structure
- 🔧 Check the [Configuration Guide](/en/config/global) for detailed configuration options
- 💻 Learn about the [Client SDK](/en/guide/client-sdk) for developing cross-protocol applications
- 🔌 Explore [Platform Documentation](/en/platform/wechat) for platform-specific features

