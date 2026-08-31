# Quick Start

## One-command installation (recommended)

On Linux and macOS, the installer checks the runtime, installs an isolated Node.js 24 when needed, installs OneBots with the Web console and OneBot v11, creates a secure configuration, and registers a persistent user service:

```bash
curl -fsSL https://raw.githubusercontent.com/lc-cn/onebots/master/install.sh | sh
```

After the first login, use **Extensions** in the Web console to compare package-versioned capability snapshots for platform adapters such as Slack or Telegram before choosing one to install. After the automatic restart, the extension card switches to the plugin's registered capability summary and complete manifest before you create an account or enter credentials. You can then follow the credential setup guide and apply the account configuration without returning to the command line. The extension manager validates the current configuration before downloading dependencies and selects npm or pnpm from the runtime directory's lockfile and `packageManager` declaration. A pnpm workspace is therefore never passed to npm, which cannot parse the workspace's `catalog:` protocol. After dependency installation completes, OneBots checks the candidate configuration, plugin entry point, and registration contract in an isolated child process, then enables the extension only after that preflight succeeds. A broken or incompatible plugin therefore cannot poison the next service start. Changes made by other management actions during installation or preflight are merged and checked again. Before restarting, OneBots repeats the isolated check from the service's real working directory without changing the live process's plugin state. A failed preflight keeps the current service online and reports the reason in the Web console. Files are stored in `~/.onebots` by default; set `ONEBOTS_HOME` before running the script to change the location.

The installer is safe to run again. Its first run creates the configuration and service. Later runs update the runtime packages while preserving existing accounts, credentials, and plugin selections, validate the resulting service definition, and restart the active service. Any failed npm or OneBots command stops the installer instead of reporting a false success.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/lc-cn/onebots/master/install.ps1 | iex
```

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

- Node.js >= 24
- pnpm >= 9.12.0 or npm (source development pins pnpm 9.15.9)

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

## Recommended: Generate a Safe Starting Configuration

Install the selected plugins, then let setup build configuration defaults from the schemas that were actually loaded. This example uses the Mock adapter and does not contact an external platform:

```bash
pnpm add onebots @onebots/adapter-mock @onebots/protocol-onebot-v11
pnpm exec onebots setup -c config.yaml -r mock -p onebot-v11
```

Setup does not create placeholder platform accounts. It generates defaults only for protocols selected with `-p` and persists the verified adapter and protocol choices under `plugins`. Foreground runs, doctor, install, update, and MCP mode can then reuse the configuration without repeated `-r` or `-p` flags. If the configuration has no management credentials, setup creates a random 256-bit `access_token`, writes it only to the mode-`0600` configuration file, and never prints the token to service logs. On a hosted platform where the file cannot be read, set `ONEBOTS_ACCESS_TOKEN` as a Secret before startup; it overrides the file token and is never persisted. Open `http://localhost:6727`, sign in, then add an account in **Configuration** and select at least one loaded protocol for it. An account without a protocol outlet is rejected before saving or startup. In non-interactive environments an existing file is preserved unless `--force` is explicit; forced updates create a `.bak` backup.

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
access_token: "replace-with-a-long-random-token" # Web console and management API token

# setup persists the default plugins to load
plugins:
  adapters: [mock]
  protocols: [onebot-v11]

# The starting file references no unloaded protocol and contacts no platform
general: {}

# Add accounts in the Web console; keys use {platform}.{account_id}
```

For complete configuration examples, see [Configuration Guide](/en/config/global).

## Start Service

### Docker (recommended for production)

If Docker is installed, you can run the image directly without Node.js on the host. See [Docker Deployment](/en/guide/docker).

```bash
# Using docker compose
docker compose up -d

# Or docker run
docker run -d -p 6727:6727 -v $(pwd)/data:/data ghcr.io/lc-cn/onebots:master
```

### Method 1: Command Line (Recommended)

```bash
# Reuse the plugins selected during setup
onebots -c config.yaml

# Explicit flags override the configured default for that category
onebots run -c config.yaml -r mock -p onebot-v11
```

### Method 2: Programmatic

```typescript
import '@onebots/adapter-wechat'
import '@onebots/protocol-onebot-v11'
import { createOnebots } from 'onebots'

const app = createOnebots('config.yaml')
await app.start()
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

## Verify the Deployment

```bash
onebots doctor -c config.yaml
curl --fail http://localhost:6727/health
curl --fail http://localhost:6727/ready
```

Before an account is configured, `/ready` keeps the management surface reachable and reports `configured: false`; doctor presents this as a warning. `/ready` returns HTTP 503 when an account is offline, a protocol outlet fails to start, or any account has no protocol outlet configured.

## Next Steps

- 📖 Read the [Architecture Guide](/en/guide/architecture) to understand the system structure
- 🔧 Check the [Configuration Guide](/en/config/global) for detailed configuration options
- 💻 Learn about the [Client SDK](/en/guide/client-sdk) for developing cross-protocol applications
- 🔌 Explore [Platform Documentation](/en/platform/wechat) for platform-specific features
