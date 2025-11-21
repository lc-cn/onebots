# OneBot V12 协议

OneBot V12 是新一代 OneBot 标准，提供了更现代化和灵活的机器人开发接口。

## 标准参考

- 官方仓库：https://github.com/botuniverse/onebot
- 官方文档：https://12.onebot.dev

## 文档导航

- [动作 (Action)](/v12/action) - API 接口文档
- [事件 (Event)](/v12/event) - 事件类型文档
- [消息段 (Segment)](/v12/segment) - 消息段格式文档

## 快速开始

### 配置示例

```yaml
protocols:
  - protocol: onebot
    version: v12
    use_http: true
    use_ws: true
    http_webhook:
      - http://localhost:5000/onebot/v12
    ws_reverse:
      - ws://localhost:5000/ws/v12
    enable_cors: true
    access_token: ""
    heartbeat_interval: 5000
```

### 通信方式

OneBot V12 支持四种通信方式：

1. **HTTP** - 提供 HTTP API 接口
2. **WebSocket** - 提供 WebSocket 连接
3. **HTTP Webhook** - 主动推送事件
4. **WebSocket (反向)** - 主动连接到客户端

### 消息格式

OneBot V12 使用统一的消息段数组格式：

```json
[
  { "type": "text", "data": { "text": "Hello" } },
  { "type": "mention", "data": { "user_id": "12345" } }
]
```

## 特性

- ✅ 完整的 OneBot 12 API 实现
- ✅ 统一的消息段格式
- ✅ 原生支持频道/公会
- ✅ 字符串ID（更好的跨平台兼容性）
- ✅ 事件过滤器支持
- ✅ 多种通信方式

## V11 vs V12 对比

### 主要改进

| 特性 | OneBot V11 | OneBot V12 |
| --- | --- | --- |
| **消息格式** | CQ码/数组两种 | 统一数组格式 |
| **ID类型** | 整数 | 字符串 |
| **事件结构** | `post_type` + `message_type` | `type` + `detail_type` |
| **平台标识** | 无 | `platform` 字段 |
| **频道支持** | 无 | 原生支持 |
| **文件操作** | 限定格式 | 支持分片上传/下载 |

### API命名对比

| 功能 | OneBot V11 | OneBot V12 |
| --- | --- | --- |
| 发送私聊消息 | `send_private_msg` | `send_message` (detail_type: private) |
| 发送群消息 | `send_group_msg` | `send_message` (detail_type: group) |
| 获取登录信息 | `get_login_info` | `get_self_info` |
| 获取陌生人信息 | `get_stranger_info` | `get_user_info` |

### 消息段对比

| OneBot V11 | OneBot V12 | 说明 |
| --- | --- | --- |
| `at` | `mention` | @某人 |
| `face` | - | 表情（平台特定） |
| `image` | `image` | 图片 |
| `record` | `voice` | 语音 |
| - | `audio` | 音频文件 |
| `video` | `video` | 视频 |
| - | `file` | 文件 |
| `location` | `location` | 位置 |
| `reply` | `reply` | 回复 |

## 平台支持

本实现支持所有实现了 Adapter 接口的平台，包括但不限于：

- QQ（官方机器人）
- 微信
- 钉钉
- Discord
- Telegram
- 其他自定义平台

不同平台对 OneBot V12 标准的支持程度可能不同，某些 API 或事件可能不可用。

## 迁移指南

### 从 V11 迁移到 V12

#### 1. 更新配置

```yaml
# V11
protocols:
  - protocol: onebot
    version: v11
    http_reverse:
      - http://localhost:5000/onebot

# V12
protocols:
  - protocol: onebot
    version: v12
    http_webhook:  # 注意：改名为 http_webhook
      - http://localhost:5000/onebot/v12
```

#### 2. 更新发送消息代码

```typescript
// V11
await api("send_private_msg", {
  user_id: 12345,
  message: "Hello [CQ:at,qq=123]",
});

// V12
await api("send_message", {
  detail_type: "private",
  user_id: "12345",  // 注意：字符串ID
  message: [
    { type: "text", data: { text: "Hello " } },
    { type: "mention", data: { user_id: "123" } },
  ],
});
```

#### 3. 更新事件处理代码

```typescript
// V11
if (event.post_type === "message" && event.message_type === "group") {
  const groupId = event.group_id;
  const userId = event.user_id;
}

// V12
if (event.type === "message" && event.detail_type === "group") {
  const groupId = event.group_id;  // 已经是字符串
  const userId = event.user_id;
}
```

#### 4. 更新消息段处理

```typescript
// V11
const atSegments = message.filter(seg => seg.type === "at");

// V12
const mentionSegments = message.filter(seg => seg.type === "mention");
```

## 最佳实践

### 1. 使用统一的消息构建

```typescript
function buildMessage(...parts: any[]) {
  const segments = [];
  for (const part of parts) {
    if (typeof part === "string") {
      segments.push({ type: "text", data: { text: part } });
    } else if (part.type) {
      segments.push(part);
    }
  }
  return segments;
}

// 使用
const message = buildMessage(
  "Hello ",
  { type: "mention", data: { user_id: "123" } },
  " !",
);
```

### 2. 处理跨平台兼容

```typescript
async function sendMessage(detail_type, target_id, message) {
  try {
    return await api("send_message", {
      detail_type,
      [detail_type === "private" ? "user_id" : "group_id"]: target_id,
      message,
    });
  } catch (error) {
    console.error("Failed to send message:", error);
    throw error;
  }
}
```

### 3. 事件过滤器

```typescript
// 只接收特定群的消息
protocols:
  - protocol: onebot
    version: v12
    filters:
      type: message
      detail_type: group
      group_id: ["123456", "789012"]
```

## 参考资源

- [OneBot 12 标准文档](https://12.onebot.dev)
- [OneBot 仓库](https://github.com/botuniverse/onebot)
- [OneBot 社区](https://github.com/botuniverse)
