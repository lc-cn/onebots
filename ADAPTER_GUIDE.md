# Creating Platform Adapters

This guide explains how to create a new platform adapter for OneBots, implementing support for platforms like QQ, WeChat, Telegram, Discord, etc.

## Overview

Platform adapters are responsible for:
1. Connecting to the platform's API/SDK
2. Implementing all required methods defined in `BaseAdapter`
3. Converting platform-specific events and data to the adapter's interface

All platform adapters must extend the `BaseAdapter` class and implement its abstract methods.

## BaseAdapter Abstract Methods

Every platform adapter MUST implement the following methods:

### Message Operations

#### `sendPrivateMessage`
```typescript
abstract sendPrivateMessage(
    uin: string,
    params: AdapterAPI.SendMessageParams
): Promise<AdapterAPI.SendMessageResult>;
```
Send a private/direct message to a user.

**Parameters:**
- `uin`: Bot account ID
- `params.user_id`: Target user ID
- `params.message`: Message content (array of segments)

**Returns:** `{ message_id: string | number }`

#### `sendGroupMessage`
```typescript
abstract sendGroupMessage(
    uin: string,
    params: AdapterAPI.SendMessageParams
): Promise<AdapterAPI.SendMessageResult>;
```
Send a message to a group/channel.

**Parameters:**
- `uin`: Bot account ID
- `params.group_id`: Target group ID
- `params.message`: Message content (array of segments)

**Returns:** `{ message_id: string | number }`

#### `deleteMessage`
```typescript
abstract deleteMessage(
    uin: string,
    params: AdapterAPI.DeleteMessageParams
): Promise<void>;
```
Delete a message by its ID.

**Parameters:**
- `uin`: Bot account ID
- `params.message_id`: Message ID to delete

#### `getMessage`
```typescript
abstract getMessage(
    uin: string,
    params: AdapterAPI.GetMessageParams
): Promise<AdapterAPI.MessageInfo>;
```
Get message information by ID.

**Parameters:**
- `uin`: Bot account ID
- `params.message_id`: Message ID

**Returns:**
```typescript
{
    message_id: string | number;
    time: number;  // Unix timestamp
    message_type: "private" | "group";
    sender: any;
    message: any[];  // Message segments
}
```

### User Operations

#### `getUserInfo`
```typescript
abstract getUserInfo(
    uin: string,
    params: AdapterAPI.GetUserInfoParams
): Promise<AdapterAPI.UserInfo>;
```
Get user information.

**Parameters:**
- `uin`: Bot account ID
- `params.user_id`: Target user ID

**Returns:**
```typescript
{
    user_id: string | number;
    nickname: string;
    // ... other platform-specific fields
}
```

#### `getFriendList`
```typescript
abstract getFriendList(uin: string): Promise<AdapterAPI.FriendInfo[]>;
```
Get bot's friend list.

**Parameters:**
- `uin`: Bot account ID

**Returns:** Array of `FriendInfo` objects

#### `getLoginInfo`
```typescript
abstract getLoginInfo(uin: string): Promise<AdapterAPI.UserInfo>;
```
Get bot's own account information.

**Parameters:**
- `uin`: Bot account ID

**Returns:** Bot's user info

### Group Operations

#### `getGroupInfo`
```typescript
abstract getGroupInfo(
    uin: string,
    params: AdapterAPI.GetGroupInfoParams
): Promise<AdapterAPI.GroupInfo>;
```
Get group information.

**Parameters:**
- `uin`: Bot account ID
- `params.group_id`: Target group ID

**Returns:**
```typescript
{
    group_id: string | number;
    group_name: string;
    member_count?: number;
    max_member_count?: number;
}
```

#### `getGroupList`
```typescript
abstract getGroupList(uin: string): Promise<AdapterAPI.GroupInfo[]>;
```
Get list of groups the bot is in.

**Parameters:**
- `uin`: Bot account ID

**Returns:** Array of `GroupInfo` objects

#### `getGroupMemberInfo`
```typescript
abstract getGroupMemberInfo(
    uin: string,
    params: AdapterAPI.GetGroupMemberInfoParams
): Promise<AdapterAPI.GroupMemberInfo>;
```
Get group member information.

**Parameters:**
- `uin`: Bot account ID
- `params.group_id`: Group ID
- `params.user_id`: Member user ID

**Returns:**
```typescript
{
    group_id: string | number;
    user_id: string | number;
    nickname: string;
    card?: string;
    role?: "owner" | "admin" | "member";
    // ... other fields
}
```

#### `getGroupMemberList`
```typescript
abstract getGroupMemberList(
    uin: string,
    params: AdapterAPI.GetGroupMemberListParams
): Promise<AdapterAPI.GroupMemberInfo[]>;
```
Get list of members in a group.

**Parameters:**
- `uin`: Bot account ID
- `params.group_id`: Group ID

**Returns:** Array of `GroupMemberInfo` objects

## Example Implementation

Here's a minimal example of a platform adapter:

```typescript
import { BaseAdapter, AdapterAPI } from "onebots";
import { App } from "@/server/app";

export class MyPlatformAdapter extends BaseAdapter<"myplatform"> {
    constructor(app: App, config: any) {
        super(app, "myplatform", config);
        this.icon = "🤖"; // Platform icon
        
        // Initialize platform SDK
        this.initializePlatform();
    }

    private initializePlatform() {
        // Connect to platform API/SDK
        // Set up event listeners
    }

    // Implement all required methods

    async sendPrivateMessage(
        uin: string,
        params: AdapterAPI.SendMessageParams
    ): Promise<AdapterAPI.SendMessageResult> {
        // Call platform API to send private message
        const result = await this.platformSDK.sendPrivateMessage({
            userId: params.user_id,
            content: this.formatMessage(params.message),
        });
        
        return {
            message_id: result.messageId,
        };
    }

    async sendGroupMessage(
        uin: string,
        params: AdapterAPI.SendMessageParams
    ): Promise<AdapterAPI.SendMessageResult> {
        // Call platform API to send group message
        const result = await this.platformSDK.sendGroupMessage({
            groupId: params.group_id,
            content: this.formatMessage(params.message),
        });
        
        return {
            message_id: result.messageId,
        };
    }

    async deleteMessage(
        uin: string,
        params: AdapterAPI.DeleteMessageParams
    ): Promise<void> {
        await this.platformSDK.deleteMessage(params.message_id);
    }

    async getMessage(
        uin: string,
        params: AdapterAPI.GetMessageParams
    ): Promise<AdapterAPI.MessageInfo> {
        const msg = await this.platformSDK.getMessage(params.message_id);
        
        return {
            message_id: msg.id,
            time: msg.timestamp,
            message_type: msg.isGroup ? "group" : "private",
            sender: msg.sender,
            message: this.parseMessage(msg.content),
        };
    }

    async getUserInfo(
        uin: string,
        params: AdapterAPI.GetUserInfoParams
    ): Promise<AdapterAPI.UserInfo> {
        const user = await this.platformSDK.getUser(params.user_id);
        
        return {
            user_id: user.id,
            nickname: user.name,
        };
    }

    async getFriendList(uin: string): Promise<AdapterAPI.FriendInfo[]> {
        const friends = await this.platformSDK.getFriends();
        
        return friends.map(f => ({
            user_id: f.id,
            nickname: f.name,
            remark: f.alias,
        }));
    }

    async getGroupInfo(
        uin: string,
        params: AdapterAPI.GetGroupInfoParams
    ): Promise<AdapterAPI.GroupInfo> {
        const group = await this.platformSDK.getGroup(params.group_id);
        
        return {
            group_id: group.id,
            group_name: group.name,
            member_count: group.memberCount,
        };
    }

    async getGroupList(uin: string): Promise<AdapterAPI.GroupInfo[]> {
        const groups = await this.platformSDK.getGroups();
        
        return groups.map(g => ({
            group_id: g.id,
            group_name: g.name,
            member_count: g.memberCount,
        }));
    }

    async getGroupMemberInfo(
        uin: string,
        params: AdapterAPI.GetGroupMemberInfoParams
    ): Promise<AdapterAPI.GroupMemberInfo> {
        const member = await this.platformSDK.getGroupMember(
            params.group_id,
            params.user_id
        );
        
        return {
            group_id: params.group_id,
            user_id: member.id,
            nickname: member.name,
            card: member.displayName,
            role: member.isAdmin ? "admin" : "member",
        };
    }

    async getGroupMemberList(
        uin: string,
        params: AdapterAPI.GetGroupMemberListParams
    ): Promise<AdapterAPI.GroupMemberInfo[]> {
        const members = await this.platformSDK.getGroupMembers(params.group_id);
        
        return members.map(m => ({
            group_id: params.group_id,
            user_id: m.id,
            nickname: m.name,
            card: m.displayName,
            role: m.isAdmin ? "admin" : "member",
        }));
    }

    async getLoginInfo(uin: string): Promise<AdapterAPI.UserInfo> {
        const botInfo = await this.platformSDK.getSelf();
        
        return {
            user_id: botInfo.id,
            nickname: botInfo.name,
        };
    }

    // Helper methods for message conversion
    private formatMessage(segments: any[]): string {
        // Convert message segments to platform format
        return segments.map(seg => {
            if (seg.type === "text") {
                return seg.data.text;
            }
            // Handle other segment types
            return "";
        }).join("");
    }

    private parseMessage(content: string): any[] {
        // Parse platform message to segments
        return [
            {
                type: "text",
                data: { text: content },
            },
        ];
    }
}
```

## Protocol Integration

Once your adapter implements all required methods, protocols can automatically use them:

1. **Milky Protocol** calls adapter methods when executing actions like `send_msg`, `get_friend_list`, etc.
2. **Satori Protocol** calls adapter methods when executing actions like `message.create`, `guild.list`, etc.
3. **OneBot Protocol** calls adapter methods for V11/V12 operations

You don't need to modify protocol implementations - they automatically work with any adapter that implements the `BaseAdapter` interface.

## Testing Your Adapter

1. Ensure all abstract methods are implemented
2. Test each method individually
3. Verify error handling
4. Test with different protocols (OneBot V11, Milky, Satori)

## Best Practices

1. **Error Handling**: Wrap platform API calls in try-catch blocks
2. **Type Conversion**: Ensure IDs and other data match the expected types
3. **Logging**: Use `this.logger` for consistent logging
4. **Rate Limiting**: Implement rate limiting if required by platform
5. **Reconnection**: Handle connection drops and auto-reconnect
6. **Message Formats**: Support common message segment types (text, image, at, etc.)

## Common Pitfalls

1. **Not implementing all methods**: All abstract methods must be implemented
2. **Wrong return types**: Ensure return types match `AdapterAPI` interfaces
3. **Missing error handling**: Always handle API errors gracefully
4. **Hardcoded values**: Use configuration for platform-specific settings

## Complete Example

See the existing adapter implementations for reference:
- Original adapter pattern: `src/adapter.ts`
- Base adapter with abstract methods: `src/adapter-base.ts`

## Summary

Creating a platform adapter requires:
1. Extend `BaseAdapter<"yourplatform">`
2. Implement all 11 abstract methods
3. Convert between platform formats and OneBots formats
4. Handle platform-specific connection and event management

The protocols (OneBot, Milky, Satori) will automatically work with your adapter without any modifications.
