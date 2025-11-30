# Satori 协议实现说明

## 📐 架构设计

Satori 协议实现遵循 OneBots 的三层架构：

```
┌─────────────────────────────────────────────────────────┐
│                  Protocol Layer (协议层)                  │
│  职责：定义协议通信、方法调用、事件格式化                    │
│  文件：src/protocols/satori/v1.ts                         │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                 Adapter Base (适配器基类)                │
│  职责：实现统一的调用方式、定义标准接口                     │
│  文件：src/adapter.ts                                     │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│            Platform Adapters (平台适配器)                │
│  职责：实现具体平台的业务逻辑                              │
│  示例：src/adapters/dingtalk/, icqq/, qq/, etc.          │
└─────────────────────────────────────────────────────────┘
```

## 🎯 Satori 协议层职责

### 1. 协议通信

**HTTP API**:
- 端点：`POST /{platform}/{account_id}/satori/v1/{method}`
- 鉴权：`Authorization: Bearer <token>`
- 请求：JSON body
- 响应：`{data: ...}` 或 `{message: ...}`

**WebSocket 事件推送**:
- 端点：`ws://{host}:{port}/{platform}/{account_id}/satori/v1/events`
- 鉴权：Header `Authorization: Bearer <token>`
- 格式：Satori Event 标准

**WebHook 事件推送**:
- 方式：POST 到外部服务器
- 鉴权：`Authorization: Bearer <token>`
- 格式：Satori Event 标准

### 2. 方法映射

Satori 协议层将 Satori API 映射到 Adapter 基类方法：

#### 消息 API (5 个)

| Satori API | Adapter 方法 | 说明 |
|-----------|-------------|------|
| `message.create` | `sendMessage()` | 发送消息 |
| `message.get` | `getMessage()` | 获取消息 |
| `message.delete` | `deleteMessage()` | 删除消息 |
| `message.update` | ❌ 不支持 | 编辑消息 |
| `message.list` | ❌ 不支持 | 消息历史 |

#### 频道 API (5 个)

| Satori API | Adapter 方法 | 说明 |
|-----------|-------------|------|
| `channel.get` | `getGroupInfo()` | 获取频道（映射为群组） |
| `channel.list` | `getGroupList()` | 获取频道列表 |
| `channel.create` | ❌ 不支持 | 创建频道 |
| `channel.update` | ❌ 不支持 | 更新频道 |
| `channel.delete` | ❌ 不支持 | 删除频道 |

#### 群组 API (2 个)

| Satori API | Adapter 方法 | 说明 |
|-----------|-------------|------|
| `guild.get` | `getGroupInfo()` | 获取群组信息 |
| `guild.list` | `getGroupList()` | 获取群组列表 |

#### 群组成员 API (4 个)

| Satori API | Adapter 方法 | 说明 |
|-----------|-------------|------|
| `guild.member.get` | `getGroupMemberInfo()` | 获取成员信息 |
| `guild.member.list` | `getGroupMemberList()` | 获取成员列表 |
| `guild.member.kick` | `kickChannelMember()` | 踢出成员 |
| `guild.member.mute` | `setChannelMemberMute()` | 禁言成员 |

#### 用户 API (2 个)

| Satori API | Adapter 方法 | 说明 |
|-----------|-------------|------|
| `user.get` | `getUserInfo()` | 获取用户信息 |
| `user.channel.create` | 虚拟实现 | 创建私聊频道 |

#### 好友 API (2 个)

| Satori API | Adapter 方法 | 说明 |
|-----------|-------------|------|
| `friend.list` | `getFriendList()` | 获取好友列表 |
| `friend.delete` | ❌ 不支持 | 删除好友 |

#### 登录信息 API (1 个)

| Satori API | Adapter 方法 | 说明 |
|-----------|-------------|------|
| `login.get` | `getLoginInfo()` | 获取登录信息 |

### 3. 数据格式转换

#### CommonEvent → Satori Event

协议层负责将通用事件格式转换为 Satori 事件格式：

```typescript
// CommonEvent (内部格式)
{
  type: "message",
  message_type: "group",
  group: { id: "123", name: "Test Group" },
  sender: { id: "456", name: "Alice" },
  message: [{ type: "text", data: { text: "Hello" } }]
}

// ↓ 转换为 Satori Event
{
  id: 1,
  type: "message-created",
  platform: "dingtalk",
  self_id: "bot_123",
  timestamp: 1234567890000,
  channel: { id: "123", type: 0, name: "Test Group" },
  user: { id: "456", name: "Alice" },
  message: { id: "msg_789", content: "Hello" }
}
```

#### Satori Message → CommonEvent Segments

```typescript
// Satori message content (输入)
"Hello <at id=\"123\" name=\"Bob\" /> world!"

// ↓ 转换为 CommonEvent segments
[
  { type: "text", data: { text: "Hello " } },
  { type: "at", data: { id: "123", name: "Bob" } },
  { type: "text", data: { text: " world!" } }
]
```

## 🔧 Adapter 基类要求

平台适配器必须实现以下所有方法以支持 Satori 协议。

**重要**：如果平台不支持某个方法，应该抛出清晰的错误：

```typescript
updateMessage(uin: string, params: UpdateMessageParams): Promise<void> {
  throw new Error("Message update not supported by this platform");
}
```

### 核心方法（大多数平台应该实现）

```typescript
abstract class Adapter {
  // 消息相关
  abstract sendMessage(uin: string, params: SendMessageParams): Promise<SendMessageResult>;
  abstract getMessage(uin: string, params: GetMessageParams): Promise<MessageInfo>;
  abstract deleteMessage(uin: string, params: DeleteMessageParams): Promise<void>;

  // 用户相关
  abstract getUserInfo(uin: string, params: GetUserInfoParams): Promise<UserInfo>;
  abstract getFriendList(uin: string): Promise<FriendInfo[]>;
  abstract getLoginInfo(uin: string): Promise<UserInfo>;

  // 群组相关
  abstract getGroupInfo(uin: string, params: GetGroupInfoParams): Promise<GroupInfo>;
  abstract getGroupList(uin: string): Promise<GroupInfo[]>;
  abstract getGroupMemberInfo(uin: string, params: GetGroupMemberInfoParams): Promise<GroupMemberInfo>;
  abstract getGroupMemberList(uin: string, params: GetGroupMemberListParams): Promise<GroupMemberInfo[]>;
  abstract kickChannelMember(uin: string, params: KickChannelMemberParams): Promise<void>;
  abstract setChannelMemberMute(uin: string, params: SetChannelMemberMuteParams): Promise<void>;
}
```

### 扩展方法（平台可选实现）

```typescript
abstract class Adapter {
  // 消息扩展
  abstract updateMessage(uin: string, params: UpdateMessageParams): Promise<void>;
  abstract getMessageHistory(uin: string, params: GetMessageHistoryParams): Promise<MessageInfo[]>;

  // 频道管理
  abstract createChannel(uin: string, params: CreateChannelParams): Promise<ChannelInfo>;
  abstract updateChannel(uin: string, params: UpdateChannelParams): Promise<void>;
  abstract deleteChannel(uin: string, params: DeleteChannelParams): Promise<void>;
  abstract createPrivateChannel(uin: string, params: CreatePrivateChannelParams): Promise<ChannelInfo>;

  // 好友管理
  abstract deleteFriend(uin: string, params: DeleteFriendParams): Promise<void>;
}
```

## 📝 实现细节

### 1. ID 转换

使用 Adapter 的 `resolveId()` 方法在 string 和 number ID 之间转换：

```typescript
// Satori 使用 string ID
const satoriId = "123456789";

// Adapter 使用 Id 对象
const adapterId = this.adapter.resolveId(satoriId);
// adapterId = { string: "123456789", number: 123456789, source: "123456789" }
```

### 2. 场景类型判断

根据 `channel_id` 判断消息场景：

```typescript
// DM channel: dm_xxx 或纯数字/用户ID
const isDM = channel_id.startsWith('dm_') || !channel_id.includes('_');
const sceneType = isDM ? 'private' : 'group';
```

### 3. 错误处理

不支持的 API 返回清晰的错误信息：

```typescript
throw new Error("Message update not supported by this adapter");
// 返回: { message: "Message update not supported by this adapter" }
```

### 4. 鉴权验证

```typescript
private verifyToken(token?: string): boolean {
  const requiredToken = this.config.token;
  if (!requiredToken) return true; // 未配置 token 则不验证
  return token === requiredToken;
}
```

## 🚀 使用示例

### 配置文件

```yaml
accounts:
  - platform: dingtalk
    account_id: dingl4hqvwwxewpk6tcn
    protocols:
      satori:
        v1:
          use_http: true
          use_ws: true
          token: "your_secret_token"
          platform: "dingtalk"
          webhooks:
            - url: "http://external-server.com/webhook"
              token: "webhook_token"
```

### HTTP API 调用

```bash
# message.create
curl -X POST http://localhost:6727/dingtalk/dingl4hqvwwxewpk6tcn/satori/v1/message.create \
  -H "Authorization: Bearer your_secret_token" \
  -H "Content-Type: application/json" \
  -d '{"channel_id": "123456", "content": "Hello, Satori!"}'

# Response
{
  "data": [
    {
      "id": "msg_789",
      "content": "Hello, Satori!"
    }
  ]
}
```

### WebSocket 连接

```javascript
const ws = new WebSocket(
  'ws://localhost:6727/dingtalk/dingl4hqvwwxewpk6tcn/satori/v1/events',
  {
    headers: {
      'Authorization': 'Bearer your_secret_token'
    }
  }
);

ws.on('message', (data) => {
  const payload = JSON.parse(data);
  if (payload.op === 0) { // EVENT
    console.log('Received event:', payload.body);
  }
});
```

## 📊 API 覆盖率

### 协议层实现 (21/21 = 100%)

所有 21 个 Satori API 都已在协议层定义并映射到 Adapter 基类方法。

**是否支持由平台适配器决定**：
- ✅ 如果平台支持该功能，平台适配器实现对应方法
- ❌ 如果平台不支持，平台适配器抛出错误（如：`throw new Error("Not supported")`）

### 核心 API (13 个) - 大多数平台支持
- ✅ message.create
- ✅ message.get
- ✅ message.delete
- ✅ channel.get
- ✅ channel.list
- ✅ guild.get
- ✅ guild.list
- ✅ guild.member.get
- ✅ guild.member.list
- ✅ user.get
- ✅ friend.list
- ✅ login.get
- ✅ user.channel.create

### 扩展 API (8 个) - 部分平台支持
- ⚠️ message.update - 取决于平台是否支持消息编辑
- ⚠️ message.list - 取决于平台是否提供消息历史 API
- ⚠️ channel.create - 取决于平台是否支持创建频道
- ⚠️ channel.update - 取决于平台是否支持更新频道
- ⚠️ channel.delete - 取决于平台是否支持删除频道
- ⚠️ friend.delete - 取决于平台是否支持删除好友
- ⚠️ guild.member.kick - 取决于平台是否支持踢出成员
- ⚠️ guild.member.mute - 取决于平台是否支持禁言成员

## 🔄 事件推送

支持三种事件推送方式：

| 方式 | 配置项 | 说明 |
|-----|-------|------|
| WebSocket | `use_ws: true` | 客户端连接到服务器 |
| WebHook | `webhooks: [...]` | 服务器推送到外部 URL |

所有事件都符合 Satori Event 标准格式。

## 📖 参考资料

- [Satori 官方文档](https://satori.chat/)
- [Satori 协议规范](https://satori.chat/zh-CN/protocol/)
- [Satori API 文档](https://satori.chat/zh-CN/protocol/api.html)
- [Satori 事件文档](https://satori.chat/zh-CN/protocol/events.html)
- [OneBots 测试文档](../../__tests__/SATORI_V1_TESTING.md)
