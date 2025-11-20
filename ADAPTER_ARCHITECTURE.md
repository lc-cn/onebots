# Adapter Architecture

This document explains the adapter architecture in onebots and clarifies which adapter class to use.

## Overview

OneBots has **TWO** adapter base classes:

1. **`Adapter`** - Legacy/Current (protocol-specific)
2. **`BaseAdapter`** - New/Recommended (protocol-independent)

## Adapter Classes

### 1. `Adapter` (src/adapter.ts) - LEGACY/CURRENT

**Status:** Maintained for backward compatibility

**Used by:**
- All existing platform adapters (qq, wechat, dingtalk)
- Current OneBot V11/V12 implementations
- Server app and core infrastructure

**Characteristics:**
- OneBot-specific with version parameters
- Methods require `version: V` parameter
- Has protocol-specific methods:
  - `toSegment()` - Convert platform message to OneBot segment
  - `fromSegment()` - Convert OneBot segment to platform message
  - `formatEventPayload()` - Format events for OneBot
  - `toCqcode()` / `fromCqcode()` - CQ code conversion
- Method signatures tied to OneBot types

**Example:**
```typescript
class QQAdapter extends Adapter<"qq", Sendable> {
    async sendPrivateMessage<V extends OneBot.Version>(
        uin: string,
        version: V,  // ← Version-specific
        args: [string, Sendable, string],  // ← Protocol-specific
    ): Promise<OneBot.MessageRet<V>> {
        // Implementation
    }
}
```

**When to use:**
- You have an existing adapter that already works
- You need to maintain compatibility with current code
- You're not ready to migrate yet

### 2. `BaseAdapter` (src/adapter-base.ts) - NEW/RECOMMENDED

**Status:** Recommended for all new code

**Used by:**
- New protocol implementations (Milky, Satori)
- Future platform adapters

**Characteristics:**
- Protocol-independent
- Universal method signatures
- No version parameters
- Uses `AdapterAPI` namespace for types
- Protocols handle their own formatting

**11 Abstract Methods:**
```typescript
export abstract class BaseAdapter<T extends string = string> {
    // Message operations
    abstract sendPrivateMessage(uin: string, params: AdapterAPI.SendMessageParams): Promise<AdapterAPI.SendMessageResult>;
    abstract sendGroupMessage(uin: string, params: AdapterAPI.SendMessageParams): Promise<AdapterAPI.SendMessageResult>;
    abstract deleteMessage(uin: string, params: AdapterAPI.DeleteMessageParams): Promise<void>;
    abstract getMessage(uin: string, params: AdapterAPI.GetMessageParams): Promise<AdapterAPI.MessageInfo>;
    
    // User operations
    abstract getUserInfo(uin: string, params: AdapterAPI.GetUserInfoParams): Promise<AdapterAPI.UserInfo>;
    abstract getFriendList(uin: string): Promise<AdapterAPI.FriendInfo[]>;
    abstract getLoginInfo(uin: string): Promise<AdapterAPI.UserInfo>;
    
    // Group operations
    abstract getGroupInfo(uin: string, params: AdapterAPI.GetGroupInfoParams): Promise<AdapterAPI.GroupInfo>;
    abstract getGroupList(uin: string): Promise<AdapterAPI.GroupInfo[]>;
    abstract getGroupMemberInfo(uin: string, params: AdapterAPI.GetGroupMemberInfoParams): Promise<AdapterAPI.GroupMemberInfo>;
    abstract getGroupMemberList(uin: string, params: AdapterAPI.GetGroupMemberListParams): Promise<AdapterAPI.GroupMemberInfo[]>;
}
```

**Example:**
```typescript
class NewQQAdapter extends BaseAdapter<"qq"> {
    async sendPrivateMessage(
        uin: string,
        params: AdapterAPI.SendMessageParams  // ← Universal
    ): Promise<AdapterAPI.SendMessageResult> {
        // Implementation
    }
}
```

**When to use:**
- Creating a new platform adapter
- Want protocol independence (works with OneBot, Milky, Satori, etc.)
- Prefer cleaner, simpler code
- Ready to follow new architecture

## Architecture Flow

### Legacy Flow (Adapter)

```
Platform Event
    ↓
Adapter.toSegment() → OneBot Segment
    ↓
Adapter.formatEventPayload() → OneBot Event
    ↓
OneBot V11/V12 Dispatch
```

### New Flow (BaseAdapter)

```
Platform Event
    ↓
Platform Adapter → AdapterAPI Types (universal)
    ↓
Protocol (OneBot/Milky/Satori) → Protocol-Specific Format
    ↓
Protocol Dispatch
```

## Key Differences

| Feature | `Adapter` (Legacy) | `BaseAdapter` (New) |
|---------|-------------------|---------------------|
| **Protocol Dependency** | OneBot-specific | Protocol-independent |
| **Version Parameters** | Required in methods | Not needed |
| **Type System** | `OneBot.*` types | `AdapterAPI.*` types |
| **Message Conversion** | Adapter handles (toSegment) | Protocol handles |
| **Event Formatting** | Adapter handles (formatEventPayload) | Protocol handles |
| **Code Complexity** | Higher (protocol logic in adapter) | Lower (adapter just provides data) |
| **Multi-Protocol Support** | Difficult | Easy |

## Migration Path

### Option 1: Keep Using `Adapter` (No Changes)

If your adapter works and you don't need multi-protocol support, no changes are needed. The `Adapter` class is fully supported and maintained.

### Option 2: Migrate to `BaseAdapter`

If you want cleaner code and multi-protocol support, follow these steps:

1. **Read MIGRATION_GUIDE.md** - Complete step-by-step instructions
2. **Change base class**: `Adapter` → `BaseAdapter`
3. **Remove version parameters** from all methods
4. **Update method signatures** to use `AdapterAPI` types
5. **Remove protocol-specific methods** (toSegment, fromSegment, etc.)
6. **Implement 11 abstract methods** with universal parameters
7. **Test with your protocols**

See **MIGRATION_GUIDE.md** for detailed before/after examples.

### Option 3: Create New Adapter with `BaseAdapter`

If creating a new adapter, use `BaseAdapter` from the start:

1. **Read ADAPTER_GUIDE.md** - Complete guide for new adapters
2. **Extend BaseAdapter**: `class MyAdapter extends BaseAdapter<"myplatform">`
3. **Implement 11 abstract methods**
4. **Emit CommonEvents** for platform events
5. **Test with protocols** (OneBot, Milky, Satori)

## Summary

- **`Adapter`**: Legacy, OneBot-specific, fully supported, no changes needed
- **`BaseAdapter`**: New, protocol-independent, recommended for new code
- **Both are valid**: Choose based on your needs
- **Migration is optional**: Existing adapters work fine as-is

## Documentation

- **MIGRATION_GUIDE.md** - How to migrate from `Adapter` to `BaseAdapter`
- **ADAPTER_GUIDE.md** - How to create new adapters with `BaseAdapter`
- **PROTOCOLS.md** - Multi-protocol usage guide

## Questions?

If you're unsure which to use:
- **Already have an adapter?** → Keep using `Adapter`
- **Creating new adapter?** → Use `BaseAdapter`
- **Want multi-protocol support?** → Migrate to `BaseAdapter`
- **Just need OneBot?** → Either works fine
