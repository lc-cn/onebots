# Adapter Guide

This guide explains how to configure and use adapters in onebots.

## Supported Adapters

onebots currently supports the following platform adapters:

| Platform | Status | Package | Description |
|----------|--------|---------|-------------|
| **QQ Official Bot** | ✅ Implemented | `@onebots/adapter-qq` | Supports QQ channels, group chats, private chats |
| **ICQQ** | ✅ Implemented | `@onebots/adapter-icqq` | Supports QQ via unofficial protocol with more complete features |
| **Kook** | ✅ Implemented | `@onebots/adapter-kook` | Supports channels, private chats, server management |
| **WeChat** | ✅ Implemented | `@onebots/adapter-wechat` | Supports WeChat Official Accounts |
| **WeChat ClawBot (iLink)** | ✅ Implemented | `@onebots/adapter-wechat-clawbot` | WeChat iLink Bot HTTP (QR login, long polling) |
| **Discord** | ✅ Implemented | `@onebots/adapter-discord` | Supports Discord bots |
| **Telegram** | ✅ Implemented | `@onebots/adapter-telegram` | Supports private chats, groups, channels |
| **Feishu** | ✅ Implemented | `@onebots/adapter-feishu` | Supports private chats, group chats, rich text messages |
| **DingTalk** | ✅ Implemented | `@onebots/adapter-dingtalk` | Supports enterprise internal apps and custom bots |
| **Slack** | ✅ Implemented | `@onebots/adapter-slack` | Supports channel messages, private chats, app commands |
| **WeCom** | ✅ Implemented | `@onebots/adapter-wecom` | Supports app message push, contact sync |
| **Microsoft Teams** | ✅ Implemented | `@onebots/adapter-teams` | Supports channel messages, private chats, adaptive cards |
| **Line** | ✅ Implemented | `@onebots/adapter-line` | Supports Line bot messages and events |
| **Email** | ✅ Implemented | `@onebots/adapter-email` | Supports SMTP sending and IMAP receiving |
| **WhatsApp** | ✅ Implemented | `@onebots/adapter-whatsapp` | Supports WhatsApp Business API |
| **Zulip** | ✅ Implemented | `@onebots/adapter-zulip` | Supports Zulip streams and private messages |

## Capability manifests

Every adapter exports and registers one runtime capability manifest. It describes actions, events, message segments, and transports, distinguishing native support, emulated projections, and unsupported features. Context-dependent entries also declare their required permissions, availability, and scenes.

Use `adapter.describeCapabilities(accountId)` for the complete manifest and `adapter.getSupportedActions(accountId)` for callable actions. OneBots verifies that every advertised action has a concrete adapter implementation, preventing capability metadata from drifting away from runtime behavior.

The versioned manifest is a closed runtime contract rather than a TypeScript-only convention. Adapter registration and construction validate all four categories, support levels, availability, scenes, permissions, message directions, transport modes, and unknown fields, then retain a deeply immutable copy. A third-party JavaScript plugin therefore cannot publish a malformed or subsequently mutated manifest to the management API; a registration failure participates in the plugin transaction rollback.

The management API and Web capability panel now call `describeCapabilities(accountId)` for each configured account. To avoid repeating large manifests, `/api/adapters` keeps the adapter default in `capabilities` and places only object-distinct account overrides in `accountCapabilities`. Selecting an account in the Web panel explicitly shows either **account-specific manifest** or **uses adapter default**. An adapter may vary its manifest using stable token, plan, or permission information, but should not present transient network failures as capability changes.

Explicit event subscriptions are also account capability boundaries. QQ/Discord intents, Telegram `allowed_updates`, and Zulip `event_types` are projected into the canonical events that the selected account can actually receive. A webhook, reverse WebSocket, or manual mode that only changes ingress transport does not invent an upstream event filter when OneBots cannot observe one.

In the Web console, **Extensions** shows a package-versioned capability catalog snapshot for platforms that are not installed yet. Users can compare actions, events, message segments, and transports without creating an account or entering credentials. Once an adapter is loaded, the page automatically replaces the snapshot with the authoritative manifest registered by that plugin. A third-party plugin without a runtime manifest is explicitly marked as unknown rather than being hidden behind the catalog snapshot. After creating an account, open **Capability overview** from **Bots** to inspect overrides caused by its token, permissions, or event subscriptions. Summary counts include native and emulated capabilities, while explicitly unsupported entries remain visible. Permission, scene, and context restrictions appear on each item. The repository runs `pnpm catalog:capabilities:check` to keep the published snapshot aligned with every built adapter manifest.

The CLI can export each selected adapter's registered default manifest without starting an account:

```bash
onebots capabilities -c config.yaml
onebots capabilities -c config.yaml --json
```

The command reuses `plugins.adapters`, with `-r` as a category-level override. It loads adapter entries without connecting to a platform or loading protocols. JSON includes package names, versions, real entry paths, category counts, and complete manifests for selection reviews and CI evidence. Plugin load failures remain in `errors` and return exit code `2`; an adapter without a registered default manifest sets `complete` to `false` and returns exit code `1`. Account permission and subscription overrides remain available after startup through `/api/adapters` and the Web capability panel.

### Native platform actions

Capabilities outside the common protocol surface are called through `adapter.callAction(accountId, action, params)`. Each adapter package also exports a closed action set, its inferred action union, and a low-level executor. For QQ these are `QQ_PLATFORM_ACTIONS`, `QQPlatformAction`, and `executeQQPlatformAction()`. The set's `has()` accepts a dynamic string and narrows its type, so integrations do not need to duplicate action names or erase the native client type.

Named actions must declare their complete field allowlist, types, required relationships, and HTTP locations; APIs that combine query parameters with a JSON body model both separately. Only explicitly low-level entries such as `call_*_api` may carry a platform-native object. Typos, stale fields, and invalid types therefore fail with structured errors before a network request is sent instead of being forwarded silently.

```ts
import {
  QQ_PLATFORM_ACTIONS,
  executeQQPlatformAction,
  type QQClient,
} from '@onebots/adapter-qq'

async function callQQ(client: QQClient, action: string, params: Record<string, unknown>) {
  if (!QQ_PLATFORM_ACTIONS.has(action)) throw new Error(`Unknown QQ action: ${action}`)
  return executeQQPlatformAction(client, action, params)
}
```

The Web console only lists adapters and protocols actually loaded with `-r` / `-p`. A plugin's registered schema is the single source for runtime validation, form sections, sensitive fields, and dynamic lists; the application does not maintain a second field catalog.

Keep using `choices` for closed enumerations. When an array should provide common suggestions while accepting ecosystem extension values, use `ui.widget: 'choice-list'` and explicitly set `allowCustomValues: true`. In that mode `choices` drives suggestions without rejecting custom strings. The flag is valid only on an array `choice-list`; invalid combinations fail during plugin registration.

Adapter names, protocol name-version pairs, and their configuration schema keys are unique within a process. The same factory or schema object may register repeatedly so plugin loading remains idempotent. A different implementation or schema cannot claim an occupied identifier: the registry throws a `ValidationError` instead of silently changing the implementation, metadata, or validation contract. Unregistering an implementation also removes its schema.

Plugin entries are resolved from the startup working directory with support for `exports.import` conditions, `module`, and `main`, then loaded through native ESM dynamic imports. Module initialization is awaited, so plugins may use top-level `await`. An initialization rejection is preserved in startup and doctor diagnostics instead of being misreported as a missing module.

A plugin must declare `onebots`, and `@onebots/core` when it uses core APIs directly, as peer dependencies supplied from the same installation root that starts the gateway. Before executing plugin code, the loader compares the real resolved package paths. Loading fails with both locations when a dependency manager installed a second copy, or when a global CLI attempts to load a plugin bound to a project-local OneBots installation. Run the project-local `onebots` command or install the plugin alongside the global CLI. A factory therefore cannot register into a separate static Registry and surface later as a misleading “initialized but did not register” error.

After initialization, the loader also verifies the plugin contract. `-r <name>` must register an adapter factory and schema under that exact name. `-p <name>-<version>` must register the matching protocol factory and `<name>.<version>` schema. A package that merely exports code, skips registration, or registers the wrong identity now fails immediately with the missing registration in setup, doctor, and service preflight diagnostics.

Plugin import and contract verification run as one serialized registry transaction. Each transaction may modify only the factory, metadata, and schema promised by its CLI name. Registering another adapter or protocol, or using another package to claim an identity that existed before import, reports the specific conflict and restores every adapter, protocol, schema, and protocol-version metadata entry to the pre-import state. Initialization errors and missing promised entries receive the same full rollback. Repeated loading of the same package and entry remains idempotent; multiple versions of one protocol may still share protocol metadata while registering their own factories and schemas. A failed plugin therefore cannot leave a partial registration or cause a false name conflict in the next plugin. Restart the process after fixing the package so Node.js imports the module again.

### Quick Links

- [QQ Adapter Documentation](/en/platform/qq)
- [ICQQ Adapter Documentation](/en/platform/icqq)
- [Kook Adapter Documentation](/en/platform/kook)
- [WeChat Adapter Documentation](/en/platform/wechat)
- [WeChat ClawBot (iLink)](/en/platform/wechat-clawbot)
- [Discord Adapter Documentation](/en/platform/discord)
- [DingTalk Adapter Documentation](/en/platform/dingtalk)
- [Telegram Adapter Documentation](/en/platform/telegram)
- [Feishu Adapter Documentation](/en/platform/feishu)
- [Slack Adapter Documentation](/en/platform/slack)
- [WeCom Adapter Documentation](/en/platform/wecom)
- [Microsoft Teams Adapter Documentation](/en/platform/teams)
- [Line Adapter Documentation](/en/platform/line)
- [Email Adapter Documentation](/en/platform/email)
- [WhatsApp Adapter Documentation](/en/platform/whatsapp)
- [Zulip Adapter Documentation](/en/platform/zulip)

## Installation

Install adapters based on the platforms you want to use:

```bash
# QQ Official Bot
npm install @onebots/adapter-qq

# Kook
npm install @onebots/adapter-kook

# WeChat
npm install @onebots/adapter-wechat

# WeChat iLink
npm install @onebots/adapter-wechat-clawbot

# Discord
npm install @onebots/adapter-discord discord.js

# Telegram
npm install @onebots/adapter-telegram grammy

# Feishu
npm install @onebots/adapter-feishu

# DingTalk
npm install @onebots/adapter-dingtalk

# Slack
npm install @onebots/adapter-slack @slack/web-api

# WeCom
npm install @onebots/adapter-wecom

# Microsoft Teams
npm install @onebots/adapter-teams botbuilder botframework-connector
```

For detailed instructions, see [Quick Start](/en/guide/start#installation).

## Configuration

onebots uses YAML format configuration files, supporting multiple protocols per account.

### Configuration Structure

```yaml
# Global configuration
port: 6727              # HTTP server port
log_level: info         # Log level
timeout: 30             # Login timeout (seconds)

# General configuration (protocol default configuration)
general:
  onebot.v11:           # OneBot V11 protocol general configuration
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  onebot.v12:           # OneBot V12 protocol general configuration
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  satori.v1:            # Satori protocol general configuration
    use_http: true
    use_ws: true
    token: ''
  milky.v1:             # Milky protocol general configuration
    use_http: true
    use_ws: true
    token: ''

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
