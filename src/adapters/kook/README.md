# Kook (开黑啦) 适配器

Kook 平台适配器，实现与 Kook（原开黑啦）平台的通信和交互。

## 特性

- ✅ WebSocket 连接（使用官方 Gateway API）
- ✅ 自动心跳保持连接
- ✅ 消息发送和接收
- ✅ KMarkdown 消息格式支持
- ✅ 服务器（Guild）和频道（Channel）管理
- ✅ 用户信息获取
- ✅ 事件处理（消息、成员变动等）
- ✅ 自动重连机制

## 配置

### 获取 Bot Token

1. 访问 [Kook 开发者中心](https://developer.kookapp.cn/)
2. 创建应用并获取 Bot Token
3. 将 Bot 添加到服务器

### 配置示例

新的配置格式：

```yaml
# Kook 机器人配置
kook.my_bot: # 格式：kook.{机器人标识}
  # 平台配置
  config:
    token: "1/ABCDEFG/aaaaaccccccccccbbbbb==" # Kook Bot Token

  # OneBot V11 协议配置
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: "my_token"
    secret: "my_secret"
    heartbeat_interval: 5

  # OneBot V12 协议配置（可选）
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: "my_token"

  # Satori V1 协议配置（可选）
  satori.v1:
    use_http: true
    use_ws: true
    token: "satori_token"
    platform: "kook"

  # Milky V1 协议配置（可选）
  milky.v1:
    use_http: true
    use_ws: true
    access_token: "milky_token"
```

**配置说明**：

- `config` 块: 包含 Kook 平台连接所需的配置（token）
- 协议块: 协议名和版本完全明确
  - `onebot.v11`: OneBot V11 协议
  - `onebot.v12`: OneBot V12 协议
  - `satori.v1`: Satori V1 协议
  - `milky.v1`: Milky V1 协议
- 可以同时启用多个协议，每个协议有独立的配置

## API 实现

### 消息相关

- ✅ `sendMessage` - 发送消息（支持文本、图片、视频、文件）
- ✅ `deleteMessage` - 删除消息
- ❌ `getMessage` - 获取消息（Kook API 不支持）

### 用户相关

- ✅ `getUserInfo` - 获取用户信息
- ✅ `getLoginInfo` - 获取 Bot 自身信息
- ❌ `getFriendList` - 获取好友列表（Kook 无好友概念）

### 服务器（Guild）相关

- ✅ `getGroupInfo` - 获取服务器信息
- ✅ `getGroupList` - 获取服务器列表
- ✅ `getGroupMemberInfo` - 获取服务器成员信息
- ✅ `getGroupMemberList` - 获取服务器成员列表

### 频道（Channel）相关

- ✅ `getChannelInfo` - 获取频道信息
- ✅ `getChannelList` - 获取频道列表
- ✅ `getChannelMemberInfo` - 获取频道成员信息
- ✅ `getChannelMemberList` - 获取频道成员列表

## 消息格式

### KMarkdown 支持

Kook 使用 KMarkdown 作为消息格式，适配器会自动转换：

#### 文本消息

```
CommonEvent.Segment[] -> KMarkdown
[{type: "text", data: {text: "Hello"}}] -> "Hello"
```

#### @提及用户

```
[{type: "at", data: {user_id: "123456"}}] -> "(met)123456(met)"
```

#### @全体成员

```
[{type: "at", data: {user_id: "all"}}] -> "(met)all(met)"
```

#### 图片

```
[{type: "image", data: {url: "https://..."}}] -> "![](https://...)"
```

#### 表情

```
[{type: "face", data: {id: "emoji_id"}}] -> "(emj)emoji_id(emj)[emoji_id]"
```

## 事件处理

### 消息事件

- `type: 1` - 文本消息
- `type: 2` - 图片消息
- `type: 3` - 视频消息
- `type: 4` - 文件消息
- `type: 9` - KMarkdown 消息
- `type: 10` - 卡片消息

### 系统事件 (type: 255)

- `added_reaction` / `deleted_reaction` - 表情回应
- `updated_message` / `deleted_message` - 消息更新/删除
- `guild_member_online` / `guild_member_offline` - 成员在线状态
- `added_guild` / `deleted_guild` - Bot 加入/离开服务器
- `joined_guild` / `exited_guild` - 成员加入/离开服务器
- `added_channel` / `updated_channel` / `deleted_channel` - 频道变更

## WebSocket 连接

### 信号类型

- `s: 0` - Event（事件）
- `s: 1` - Hello（握手）
- `s: 2` - Ping（心跳）
- `s: 3` - Pong（心跳响应）
- `s: 5` - Reconnect（服务器请求重连）
- `s: 6` - Resume ACK（恢复连接确认）

### 心跳机制

适配器每 30 秒自动发送心跳保持连接：

```json
{
  "s": 2,
  "sn": 123
}
```

### 自动重连

连接断开后，适配器会在 5 秒后自动尝试重连。

## 限制说明

### Kook API 限制

1. **无法通过 ID 获取历史消息**: Kook API 不提供根据 message_id 查询消息的接口
2. **无好友系统**: Kook 是服务器/频道模式，没有传统的好友概念
3. **频道成员信息复用服务器成员**: Kook 的成员信息是服务器级别的，不是频道级别

### 速率限制

Kook API 有速率限制，请注意：

- 全局: 120 次/分钟
- 单个接口: 5 次/秒

## 示例

### 发送文本消息

```typescript
await kookAdapter.sendMessage("bot_id", {
  scene_type: "group",
  scene_id: "channel_id",
  message: [{ type: "text", data: { text: "Hello, Kook!" } }],
});
```

### 发送带@的消息

```typescript
await kookAdapter.sendMessage("bot_id", {
  scene_type: "group",
  scene_id: "channel_id",
  message: [
    { type: "at", data: { user_id: "123456" } },
    { type: "text", data: { text: " 你好！" } },
  ],
});
```

### 发送图片消息

```typescript
await kookAdapter.sendMessage("bot_id", {
  scene_type: "group",
  scene_id: "channel_id",
  message: [{ type: "image", data: { url: "https://example.com/image.png" } }],
});
```

## 调试

启用日志查看详细信息：

```yaml
log_level: debug
```

日志输出包括：

- WebSocket 连接状态
- 心跳发送和接收
- 事件接收和处理
- API 请求和响应

## 参考资料

- [Kook 开发者文档](https://developer.kookapp.cn/doc/)
- [Kook Bot API](https://developer.kookapp.cn/doc/reference)
- [KMarkdown 语法](https://developer.kookapp.cn/doc/kmarkdown)

## 注意事项

1. **Token 安全**: 请勿将 Bot Token 提交到公开仓库
2. **权限配置**: 确保 Bot 在服务器中有必要的权限
3. **消息频率**: 注意遵守 Kook 的速率限制
4. **KMarkdown**: 特殊字符需要转义
5. **频道类型**: 注意区分文字频道、语音频道等不同类型

## 故障排查

### 连接失败

- 检查 Token 是否正确
- 检查网络连接
- 查看日志中的错误信息

### 消息发送失败

- 确认 Bot 在目标频道中
- 检查 Bot 是否有发送消息权限
- 确认频道 ID 正确

### 收不到事件

- 检查 WebSocket 连接状态
- 确认心跳正常
- 查看 Bot 是否在线

## 更新日志

### v1.0.0 (2025-01-21)

- ✅ 初始实现
- ✅ WebSocket 连接和心跳
- ✅ 消息收发
- ✅ KMarkdown 支持
- ✅ 服务器和频道管理
- ✅ 事件处理
- ✅ 自动重连
