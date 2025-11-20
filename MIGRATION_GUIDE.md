# Adapter Migration Guide

This guide explains how to migrate existing adapters from the old architecture to the new BaseAdapter system.

## Overview of Changes

### Old Architecture
```
Platform Adapter → OneBot Protocol → Dispatch
```

### New Architecture
```
Platform Adapter (BaseAdapter) → CommonEvent → Protocol (OneBot/Milky/Satori) → Dispatch
```

## Key Differences

1. **Base Class**: `Adapter` → `BaseAdapter`
2. **Abstract Methods**: Old adapters had protocol-specific methods, new adapters have platform-agnostic methods
3. **Event Handling**: Old adapters emitted protocol-specific events, new adapters work with `CommonEvent`
4. **Message Format**: Old adapters worked with protocol-specific segments, new adapters use universal message format

## Migration Steps

### Step 1: Update Class Declaration

**Old:**
```typescript
import { Adapter } from "@/adapter";

export default class QQAdapter extends Adapter<"qq", Sendable> {
    constructor(app: App, config: QQAdapter.Config) {
        super(app, "qq", config);
    }
}
```

**New:**
```typescript
import { BaseAdapter, AdapterAPI } from "@/adapter-base";

export default class QQAdapter extends BaseAdapter<"qq"> {
    constructor(app: App, config: QQAdapter.Config) {
        super(app, "qq", config);
    }
}
```

### Step 2: Implement Required Abstract Methods

The new `BaseAdapter` requires implementing 11 abstract methods. Here's how to map old methods to new ones:

#### 2.1 Send Private Message

**Old:**
```typescript
async sendPrivateMessage<V extends OneBot.Version>(
    uin: string,
    version: V,
    args: [string, Sendable, string],
): Promise<OneBot.MessageRet<V>> {
    let [user_id, message, source] = args;
    const bot = this.getOneBot<Bot>(uin);
    const result = await bot.internal.sendPrivateMessage(user_id, message);
    return { message_id: result.id };
}
```

**New:**
```typescript
async sendPrivateMessage(
    uin: string,
    params: AdapterAPI.SendMessageParams
): Promise<AdapterAPI.SendMessageResult> {
    const bot = this.getOneBot<Bot>(uin);
    const result = await bot.internal.sendPrivateMessage(
        params.user_id, 
        params.message
    );
    return { message_id: result.id };
}
```

#### 2.2 Send Group Message

**Old:**
```typescript
async sendGroupMessage<V extends OneBot.Version>(
    uin: string,
    version: V,
    args: [string, Sendable, string],
): Promise<OneBot.MessageRet<V>> {
    let [group_id, message, source] = args;
    const bot = this.getOneBot<Bot>(uin);
    const result = await bot.internal.sendGroupMessage(group_id, message);
    return { message_id: result.id };
}
```

**New:**
```typescript
async sendGroupMessage(
    uin: string,
    params: AdapterAPI.SendMessageParams
): Promise<AdapterAPI.SendMessageResult> {
    const bot = this.getOneBot<Bot>(uin);
    const result = await bot.internal.sendGroupMessage(
        params.group_id,
        params.message
    );
    return { message_id: result.id };
}
```

#### 2.3 Delete Message

**Old:**
```typescript
async deleteMessage(
    uin: string, 
    version: "V11" | "V12", 
    [message_id]: [string]
): Promise<boolean> {
    const bot = this.getOneBot<Bot>(uin).internal;
    return bot.recallMessage(message_id);
}
```

**New:**
```typescript
async deleteMessage(
    uin: string,
    params: AdapterAPI.DeleteMessageParams
): Promise<void> {
    const bot = this.getOneBot<Bot>(uin).internal;
    await bot.recallMessage(params.message_id);
}
```

#### 2.4 Get Message

**Old:**
```typescript
async getMessage<V extends OneBot.Version>(
    uin: string,
    version: V,
    args: [string],
): Promise<OneBot.Message<V>> {
    const bot = this.getOneBot<Bot>(uin).internal;
    return bot.getMessage(args[0]);
}
```

**New:**
```typescript
async getMessage(
    uin: string,
    params: AdapterAPI.GetMessageParams
): Promise<AdapterAPI.MessageInfo> {
    const bot = this.getOneBot<Bot>(uin).internal;
    const msg = await bot.getMessage(params.message_id);
    return {
        message_id: msg.id,
        time: msg.timestamp,
        message_type: msg.message_type,
        sender: msg.sender,
        message: msg.message
    };
}
```

#### 2.5 Get User Info

**New method** (implement if platform supports):
```typescript
async getUserInfo(
    uin: string,
    params: AdapterAPI.GetUserInfoParams
): Promise<AdapterAPI.UserInfo> {
    const bot = this.getOneBot<Bot>(uin).internal;
    const user = await bot.getUserInfo(params.user_id);
    return {
        user_id: user.user_id,
        nickname: user.nickname
    };
}
```

#### 2.6 Get Friend List

**Old:**
```typescript
async getFriendList<V extends OneBot.Version>(
    uin: string,
    version: V,
): Promise<OneBot.UserInfo<V>[]> {
    const bot = this.getOneBot<Bot>(uin).internal;
    return bot.getFriendList();
}
```

**New:**
```typescript
async getFriendList(uin: string): Promise<AdapterAPI.FriendInfo[]> {
    const bot = this.getOneBot<Bot>(uin).internal;
    const friends = await bot.getFriendList();
    return friends.map(f => ({
        user_id: f.user_id,
        nickname: f.nickname,
        remark: f.remark
    }));
}
```

#### 2.7 Get Login Info

**New method** (implement bot's own info):
```typescript
async getLoginInfo(uin: string): Promise<AdapterAPI.UserInfo> {
    const bot = this.getOneBot<Bot>(uin);
    return {
        user_id: uin,
        nickname: bot.nickname
    };
}
```

#### 2.8 Get Group Info

**New method**:
```typescript
async getGroupInfo(
    uin: string,
    params: AdapterAPI.GetGroupInfoParams
): Promise<AdapterAPI.GroupInfo> {
    const bot = this.getOneBot<Bot>(uin).internal;
    const group = await bot.getGroupInfo(params.group_id);
    return {
        group_id: group.group_id,
        group_name: group.group_name,
        member_count: group.member_count,
        max_member_count: group.max_member_count
    };
}
```

#### 2.9 Get Group List

**Old:**
```typescript
async getGroupList<V extends OneBot.Version>(
    uin: string,
    version: V,
): Promise<OneBot.GroupInfo<V>[]> {
    const bot = this.getOneBot<Bot>(uin).internal;
    return bot.getGroupList();
}
```

**New:**
```typescript
async getGroupList(uin: string): Promise<AdapterAPI.GroupInfo[]> {
    const bot = this.getOneBot<Bot>(uin).internal;
    const groups = await bot.getGroupList();
    return groups.map(g => ({
        group_id: g.group_id,
        group_name: g.group_name,
        member_count: g.member_count,
        max_member_count: g.max_member_count
    }));
}
```

#### 2.10 Get Group Member Info

**New method**:
```typescript
async getGroupMemberInfo(
    uin: string,
    params: AdapterAPI.GetGroupMemberInfoParams
): Promise<AdapterAPI.GroupMemberInfo> {
    const bot = this.getOneBot<Bot>(uin).internal;
    const member = await bot.getGroupMemberInfo(
        params.group_id,
        params.user_id
    );
    return {
        group_id: member.group_id,
        user_id: member.user_id,
        nickname: member.nickname,
        card: member.card,
        role: member.role
    };
}
```

#### 2.11 Get Group Member List

**Old:**
```typescript
async getGroupMemberList<V extends OneBot.Version>(
    uin: string,
    version: V,
    args: [string],
): Promise<OneBot.GroupMemberInfo<V>[]> {
    const bot = this.getOneBot<Bot>(uin).internal;
    return bot.getGroupMemberList(args[0]);
}
```

**New:**
```typescript
async getGroupMemberList(
    uin: string,
    params: AdapterAPI.GetGroupMemberListParams
): Promise<AdapterAPI.GroupMemberInfo[]> {
    const bot = this.getOneBot<Bot>(uin).internal;
    const members = await bot.getGroupMemberList(params.group_id);
    return members.map(m => ({
        group_id: m.group_id,
        user_id: m.user_id,
        nickname: m.nickname,
        card: m.card,
        role: m.role
    }));
}
```

### Step 3: Remove Protocol-Specific Methods

Remove these old methods that are no longer needed:
- `toSegment()` - Protocol now handles message formatting
- `fromSegment()` - Protocol now handles message parsing
- `formatEventPayload()` - Use CommonEvent instead
- `parseMessage()` - Protocol-specific
- `getSelfInfo()` - Use `getLoginInfo()` instead
- `call()` - Direct calls replaced with specific methods

### Step 4: Update Event Emission

**Old:** Emitting protocol-specific events
```typescript
this.emit("message.receive", uin, event);
this.emit("notice.receive", uin, event);
this.emit("request.receive", uin, event);
```

**New:** Protocols automatically receive CommonEvent
```typescript
// No manual emission needed - protocols listen to adapter methods
// Just implement the abstract methods above
```

### Step 5: Remove Version-Specific Logic

**Old:** Methods had version parameters
```typescript
async sendPrivateMessage<V extends OneBot.Version>(
    uin: string,
    version: V,  // ← Remove this
    args: [string, Sendable, string],
)
```

**New:** Methods are version-agnostic
```typescript
async sendPrivateMessage(
    uin: string,
    params: AdapterAPI.SendMessageParams  // ← Universal format
)
```

## Complete Example: QQ Adapter Migration

### Before (Old Adapter)
```typescript
import { Adapter } from "@/adapter";
import { Bot, Sendable } from "qq-official-bot";

export default class QQAdapter extends Adapter<"qq", Sendable> {
    async sendPrivateMessage<V extends OneBot.Version>(
        uin: string,
        version: V,
        args: [string, Sendable, string],
    ): Promise<OneBot.MessageRet<V>> {
        let [user_id, message, source] = args;
        const bot = this.getOneBot<Bot>(uin);
        const result = await bot.internal.sendPrivateMessage(user_id, message);
        return { message_id: result.id };
    }
    
    toSegment<V extends OneBot.Version>(version: V, message: any): OneBot.Segment<V>[] {
        // Protocol-specific conversion
    }
}
```

### After (New Adapter)
```typescript
import { BaseAdapter, AdapterAPI } from "@/adapter-base";
import { Bot } from "qq-official-bot";

export default class QQAdapter extends BaseAdapter<"qq"> {
    async sendPrivateMessage(
        uin: string,
        params: AdapterAPI.SendMessageParams
    ): Promise<AdapterAPI.SendMessageResult> {
        const bot = this.getOneBot<Bot>(uin);
        const result = await bot.internal.sendPrivateMessage(
            params.user_id,
            params.message
        );
        return { message_id: result.id };
    }
    
    async sendGroupMessage(
        uin: string,
        params: AdapterAPI.SendMessageParams
    ): Promise<AdapterAPI.SendMessageResult> {
        const bot = this.getOneBot<Bot>(uin);
        const result = await bot.internal.sendGroupMessage(
            params.group_id,
            params.message
        );
        return { message_id: result.id };
    }
    
    async deleteMessage(
        uin: string,
        params: AdapterAPI.DeleteMessageParams
    ): Promise<void> {
        const bot = this.getOneBot<Bot>(uin).internal;
        await bot.recallMessage(params.message_id);
    }
    
    async getMessage(
        uin: string,
        params: AdapterAPI.GetMessageParams
    ): Promise<AdapterAPI.MessageInfo> {
        const bot = this.getOneBot<Bot>(uin).internal;
        const msg = await bot.getMessage(params.message_id);
        return {
            message_id: msg.id,
            time: msg.timestamp,
            message_type: msg.message_type,
            sender: msg.sender,
            message: msg.message
        };
    }
    
    async getUserInfo(
        uin: string,
        params: AdapterAPI.GetUserInfoParams
    ): Promise<AdapterAPI.UserInfo> {
        const bot = this.getOneBot<Bot>(uin).internal;
        const user = await bot.getUserInfo(params.user_id);
        return {
            user_id: user.user_id,
            nickname: user.nickname
        };
    }
    
    async getFriendList(uin: string): Promise<AdapterAPI.FriendInfo[]> {
        const bot = this.getOneBot<Bot>(uin).internal;
        const friends = await bot.getFriendList();
        return friends.map(f => ({
            user_id: f.user_id,
            nickname: f.nickname,
            remark: f.remark
        }));
    }
    
    async getLoginInfo(uin: string): Promise<AdapterAPI.UserInfo> {
        const bot = this.getOneBot<Bot>(uin);
        return {
            user_id: uin,
            nickname: bot.nickname
        };
    }
    
    async getGroupInfo(
        uin: string,
        params: AdapterAPI.GetGroupInfoParams
    ): Promise<AdapterAPI.GroupInfo> {
        const bot = this.getOneBot<Bot>(uin).internal;
        const group = await bot.getGroupInfo(params.group_id);
        return {
            group_id: group.group_id,
            group_name: group.group_name,
            member_count: group.member_count
        };
    }
    
    async getGroupList(uin: string): Promise<AdapterAPI.GroupInfo[]> {
        const bot = this.getOneBot<Bot>(uin).internal;
        const groups = await bot.getGroupList();
        return groups.map(g => ({
            group_id: g.group_id,
            group_name: g.group_name,
            member_count: g.member_count
        }));
    }
    
    async getGroupMemberInfo(
        uin: string,
        params: AdapterAPI.GetGroupMemberInfoParams
    ): Promise<AdapterAPI.GroupMemberInfo> {
        const bot = this.getOneBot<Bot>(uin).internal;
        const member = await bot.getGroupMemberInfo(
            params.group_id,
            params.user_id
        );
        return {
            group_id: member.group_id,
            user_id: member.user_id,
            nickname: member.nickname,
            card: member.card,
            role: member.role
        };
    }
    
    async getGroupMemberList(
        uin: string,
        params: AdapterAPI.GetGroupMemberListParams
    ): Promise<AdapterAPI.GroupMemberInfo[]> {
        const bot = this.getOneBot<Bot>(uin).internal;
        const members = await bot.getGroupMemberList(params.group_id);
        return members.map(m => ({
            group_id: m.group_id,
            user_id: m.user_id,
            nickname: m.nickname,
            card: m.card,
            role: m.role
        }));
    }
}
```

## Benefits of Migration

1. **Protocol Independence**: Your adapter works with OneBot, Milky, Satori, and any future protocols automatically
2. **Cleaner Code**: No version-specific logic cluttering your adapter
3. **Type Safety**: Strong TypeScript types for all methods
4. **Easier Testing**: Test adapter methods independently of protocols
5. **Better Separation**: Platform logic stays in adapter, protocol logic stays in protocols

## Common Pitfalls

### 1. Message Format
**Old:** Adapters handled protocol-specific message segments
**New:** Use universal message format, protocols handle conversion

### 2. Version Parameters
**Old:** Methods had `version` parameter
**New:** Methods are version-agnostic, protocols handle versioning

### 3. Event Names
**Old:** `message.receive`, `notice.receive`, etc.
**New:** Not needed - protocols automatically consume adapter methods

### 4. Return Types
**Old:** `Promise<OneBot.MessageRet<V>>`
**New:** `Promise<AdapterAPI.SendMessageResult>`

## Need Help?

See `ADAPTER_GUIDE.md` for creating new adapters from scratch.

## Migration Checklist

- [ ] Update base class to `BaseAdapter`
- [ ] Implement all 11 abstract methods
- [ ] Remove protocol-specific methods (`toSegment`, `fromSegment`, etc.)
- [ ] Remove version parameters from methods
- [ ] Update return types to use `AdapterAPI` types
- [ ] Remove manual event emission
- [ ] Test with OneBot V11/V12
- [ ] Test with Milky (if applicable)
- [ ] Test with Satori (if applicable)
- [ ] Update documentation
