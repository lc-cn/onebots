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

