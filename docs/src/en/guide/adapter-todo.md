# Adapter Roadmap

This document lists the IM platform adapters planned for the onebots project.

## Implemented Adapters

| Platform | Status | Package | Description |
|----------|--------|---------|-------------|
| **QQ Official Bot** | ✅ Implemented | `@onebots/adapter-qq` | Supports QQ channels, group chats, private chats |
| **Kook** | ✅ Implemented | `@onebots/adapter-kook` | Supports channels, private chats, server management |
| **WeChat** | ✅ Implemented | `@onebots/adapter-wechat` | Supports WeChat Official Accounts |
| **WeChat ClawBot (iLink)** | ✅ Implemented | `@onebots/adapter-wechat-clawbot` | WeChat iLink Bot HTTP |
| **Discord** | ✅ Implemented | `@onebots/adapter-discord` | Supports Discord bots |
| **Telegram** | ✅ Implemented | `@onebots/adapter-telegram` | Supports private chats, groups, channels |
| **Feishu** | ✅ Implemented | `@onebots/adapter-feishu` | Supports private chats, group chats, rich text messages |
| **DingTalk** | ✅ Implemented | `@onebots/adapter-dingtalk` | Supports enterprise internal apps and custom bots |
| **Slack** | ✅ Implemented | `@onebots/adapter-slack` | Supports channel messages, private chats, app commands |
| **WeCom** | ✅ Implemented | `@onebots/adapter-wecom` | Supports app message push, contact sync |
| **Microsoft Teams** | ✅ Implemented | `@onebots/adapter-teams` | Supports channel messages, private chats, adaptive cards |

## Planned Adapters

### High Priority

#### 1. ICQQ Adapter

**Status**: Planned  
**Priority**: High  
**Expected Package**: `@onebots/adapter-icqq`

**Features**:
- ✅ ICQQ Protocol Support
  - Connect to QQ via ICQQ protocol (unofficial API)
  - Provides more complete QQ functionality
- ✅ Feature Support
  - Friend list management
  - Group management
  - Message sending/receiving
  - File transfer

**References**:
- [ICQQ Project](https://github.com/icqqjs/icqq)
- ICQQ Protocol Documentation

---

### Medium Priority

#### 2. Matrix Adapter

**Status**: Planned  
**Priority**: Medium  
**Expected Package**: `@onebots/adapter-matrix`

**Features**:
- ✅ Matrix Protocol Support
  - Room messages
  - End-to-end encryption
  - Cross-platform communication
- ✅ Feature Support
  - Message sending/receiving
  - Room management
  - User management

**References**:
- [Matrix Protocol](https://matrix.org/docs/spec/)
- [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/)

---

## Priority Guidelines

### Priority Evaluation Criteria

1. **High Priority**:
   - Mainstream domestic platforms with large user base
   - Enterprise application scenarios
   - Clear API documentation and SDK

2. **Medium Priority**:
   - Mainstream international platforms
   - Special feature requirements
   - High community demand

3. **Low Priority**:
   - Niche platforms
   - Special protocols
   - Experimental features

## Contributing

If you want to contribute a new adapter to onebots, please refer to:

1. [Adapter Development Guide](/en/guide/adapter) - Learn how to develop adapters
2. [Existing Adapter Code](https://github.com/lc-cn/onebots/tree/master/adapters) - Reference implemented adapters
3. [Core Interface Documentation](https://github.com/lc-cn/onebots/tree/master/packages/core) - Learn about Adapter base class

## Related Links

- [Adapter Configuration Guide](/en/guide/adapter)
- [Platform Configuration](/en/config/platform)
- [Quick Start](/en/guide/start)

