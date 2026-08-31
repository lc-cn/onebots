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

In the Web console, open **Capability overview** from **Bots** to inspect all four categories for each loaded adapter. Summary counts include native and emulated capabilities, while explicitly unsupported entries remain visible. Permission, scene, and context restrictions appear on each item. Because this view consumes the runtime manifest, it describes the adapters loaded in the current deployment rather than a static platform catalog.

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

Adapter names and protocol name-version pairs are unique within a process. The same implementation may register repeatedly so plugin loading remains idempotent. A different implementation cannot claim an occupied identifier: the registry throws a `ValidationError` instead of silently replacing the implementation while retaining stale metadata. Unregistering an implementation also removes its schema.

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
