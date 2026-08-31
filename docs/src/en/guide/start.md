# Quick Start

## One-command installation (recommended)

On Linux and macOS, the installer checks the runtime, installs an isolated Node.js 24 when needed, installs OneBots with the Web console and OneBot v11, creates a secure configuration, and registers a persistent user service. It installs OneBots and its matching Web dependency first, then reads the default protocol version from the extension-version catalog published inside that main package. A missing Web entry point or mismatched installed protocol version stops the run before configuration or service creation:

```bash
curl -fsSL https://raw.githubusercontent.com/lc-cn/onebots/master/install.sh | sh
```

After the first login, use **Extensions** in the Web console to compare package-versioned capability snapshots for platform adapters such as Slack or Telegram before choosing one to install. After the automatic restart, the extension card switches to the plugin's registered capability summary and complete manifest before you create an account or enter credentials. Every adapter and protocol shows the exact package version verified with the current OneBots release. Installation uses that version instead of silently following npm `latest`; if a manually installed version differs, the page shows both and offers to switch back to the verified version. The extension manager validates the current configuration before downloading dependencies and selects npm or pnpm from the runtime directory's lockfile and `packageManager` declaration. A pnpm workspace is therefore never passed to npm, which cannot parse the workspace's `catalog:` protocol. After dependency installation completes, OneBots checks the installed version, candidate configuration, plugin entry point, and registration contract in an isolated child process, then enables the extension only after every check succeeds. A broken or incompatible plugin therefore cannot poison the next service start. Changes made by other management actions during installation or preflight are merged and checked again. Before restarting, OneBots repeats the isolated check from the service's real working directory without changing the live process's plugin state. A failed preflight keeps the current service online and reports the reason in the Web console. After a successful preflight, the old process gracefully releases accounts, protocols, and network resources. The page records its `instance_id` and refreshes only after the health endpoint returns from a different new OneBots instance; an old or unidentified endpoint eventually produces an explicit timeout. Files are stored in `~/.onebots` by default; set `ONEBOTS_HOME` before running the script to change the location.

When no bots exist after the first login, the **Bots** empty state provides **Compare platform capabilities** and one contextual primary action. A deployment without a loaded adapter goes directly to **Install platform adapter**; one with an adapter goes to **Add bot account**. A new operator can therefore move from platform selection to account creation without first learning `-r`, configuration keys, or the sidebar structure.

The installer is safe to run again. Its first run creates the configuration and service. Later runs update the runtime packages while preserving existing accounts, credentials, and plugin selections, validate the resulting service definition, and restart the active service. After the start command returns, the script retries `onebots status` for a bounded period to verify the process manager, online OneBots identity and version, and readiness. It prints **installation complete** and the management URL only after that gate passes, and prints the first-login token only when this run created the configuration. A repeated installation neither extracts nor outputs the existing token, so an upgrade terminal or automation log cannot expose the long-lived management credential again. Any failed npm or OneBots command, or failed online verification, stops the installer instead of reporting a false success.

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

Setup does not create placeholder platform accounts. It generates defaults only for protocols selected with `-p` and persists the verified adapter and protocol choices under `plugins`. Foreground runs, doctor, install, update, and MCP mode can then reuse the configuration without repeated `-r` or `-p` flags. Even when the first setup selects no plugins, its completion output provides four directly executable next steps: compare platform capabilities, run doctor, start in the foreground, and install the managed service. An operator can inspect the offline capability catalog shipped with the current OneBots version before installing from Web Extensions. If the configuration has no management credentials, setup creates a random 256-bit `access_token`, writes it only to the mode-`0600` configuration file, and never prints the token to service logs. On a hosted platform where the file cannot be read, set `ONEBOTS_ACCESS_TOKEN` as a Secret before startup; it overrides the file token and is never persisted. Open `http://localhost:6727` and sign in. The Bots page first verifies that an adapter and at least one open protocol are loaded. Missing prerequisites link directly to the matching Extensions category; the account wizard stays closed while the inventory is loading, and an unavailable inventory offers a recoverable check action. Extensions provide type-specific next steps: an adapter opens account creation with its platform selected, while a protocol uses its explicitly declared Schema key to open account outlets. Creating or editing an account from that context directly locates and enables the target protocol. The server checks every configuration target against the promised plugin identity; a drift disables only that entry and exposes the reason. Direct entry from Configuration still distinguishes loading, failed discovery, a confirmed empty adapter set, and a removed account adapter. The wizard blocks saving until at least one protocol is enabled, and the server repeats the same validation before saving or startup. In non-interactive environments an existing file is preserved unless `--force` is explicit; forced updates create a `.bak` backup.

`onebots ui --web -c config.yaml` opens the local origin where the management page is actually served. Host `path` is only the Router HTTP prefix and is not appended to the page URL; the page reads it from runtime metadata. `onebots send -c config.yaml --channel <platform.account> --target_type private <target> <message>` uses the same normalized prefix and management credential precedence: `ONEBOTS_ACCESS_TOKEN` overrides the file token, while username/password configuration first creates a Bearer session and revokes it after either success or failure. An explicit `--url` accepts only an HTTP(S) gateway base without URL credentials, a query string, or a fragment, preventing management tokens from being sent to an ambiguous target.

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

Doctor verifies that every extension catalog **Configure** target matches its plugin identity and that the install allowlist, pinned package versions, and adapter capability snapshots form one closed set. Deployment scripts and CI can inspect the `extension-catalog` check in `--json` output; missing, orphaned, version-mismatched, or configuration-target entries are all reported with their reasons. Before an account is configured, `/ready` keeps the management surface reachable and reports `configured: false`; doctor presents this as a warning. `/ready` returns HTTP 503 when an account is offline, a protocol outlet fails to start, or any account has no protocol outlet configured.

Before selecting an adapter, installing a plugin, or creating an account, `onebots capabilities --json` exports the complete platform capability catalog shipped with the current OneBots version. Catalog entries use `source: "catalog"` and `entryPath: null`. The command first runs the same closed-set validation as doctor, so a snapshot with missing entries cannot report `complete: true`. Once configuration or `-r` selects adapters, the command loads their plugins without connecting accounts and gives the registered `source: "runtime"` manifests precedence. A load failure still returns an error exit code while retaining any available catalog snapshot for troubleshooting and platform selection.

The Web extension center enforces the same gate. When the catalog is not closed, the page shows the complete reason, suppresses unverified static capability evidence, and disables every install or version-switch action. The server rejects the request again before reading configuration or invoking a package manager. Already loaded plugins keep their runtime manifests, so existing account configuration and operation do not depend on a broken static catalog.

Each extension card evaluates the package on disk, startup configuration, and current process separately instead of labeling every `installed` state as pending restart. Even before an account exists, users can search platform metadata or the authoritative capability manifest. Multiple terms must match the same platform or capability entry. Capability matches include only native or emulated support, so an explicitly unsupported declaration never presents a platform as a candidate; matching manifest entries expand automatically. Scene, support, availability, and direction evidence keeps both a human label and the raw enum, such as **群聊 · group**, so `群聊 file` and `group file` resolve to the same manifest entry. A dependency left after failed preflight is shown as **installed, not enabled** with an **Enable and restart** recovery action. A persisted selection not yet loaded is shown as **waiting for restart**. A configured extension with a missing dependency, or a process still running an extension removed from startup configuration, receives its own fault state and matching recovery action. Retries after a disconnect and simultaneous requests from multiple pages for the same extension join one server operation instead of running the package manager or preflight twice; different extensions remain mutually exclusive. The page keeps the active server installation visible and disables every other install action even when type or capability search hides its card. The extension list retains the compatible `installing` boolean and adds a stable `operationId`, `startedAt`, and `phase` for the active operation. The page distinguishes dependency installation and verification from isolated preflight. For each extension, the current service instance also retains the latest successful or failed operation ID, timestamps, and redacted diagnostic, so another page or a reopened page can explain a failure. A retry replaces this temporary evidence, and a service restart clears it. If a browser or reverse proxy drops the long install request, the page reconciles operation IDs: it keeps polling an active server operation, continues the verified restart after a new successful result, or presents the new failure diagnostic. A stale result is never treated as proof that this request succeeded.

After installation, the server also declares whether the current process has a verified restart supervisor. A system service created by `onebots install` can safely switch instances. Docker or another orchestrator exposes the same ability only when its restart policy is paired with `ONEBOTS_RESTARTABLE=1`. A directly launched foreground process stays online and the page reports “installation complete, restart manually” instead of exiting and waiting for a replacement that cannot appear. The System page uses the same evidence and disables its restart button when no supervisor is available.

## Next Steps

- 📖 Read the [Architecture Guide](/en/guide/architecture) to understand the system structure
- 🔧 Check the [Configuration Guide](/en/config/global) for detailed configuration options
- 💻 Learn about the [Client SDK](/en/guide/client-sdk) for developing cross-protocol applications
- 🔌 Explore [Platform Documentation](/en/platform/wechat) for platform-specific features
