# OneBot V12 协议

OneBot V12 是 OneBot 协议的下一代版本，提供了更现代化、更灵活的机器人接口标准。

## 协议简介

OneBot V12 相比 V11 的改进：

- 更规范的消息段格式（替代 CQ 码）
- 更完善的类型系统
- 跨平台特性支持
- 更好的扩展性
- 标准化的错误处理

## 标准参考

- 官方仓库：https://github.com/botuniverse/onebot
- 官方文档：https://12.onebot.dev

## 文档导航

- [动作 (Action)](/protocol/onebot-v12/action) - API 接口文档
- [事件 (Event)](/protocol/onebot-v12/event) - 事件类型文档
- [消息段 (Segment)](/protocol/onebot-v12/segment) - 消息段格式文档

## 安装

```bash
npm install @onebots/protocol-onebot-v12
```

## 配置

在 `config.yaml` 中配置 OneBot V12 协议：

```yaml
# 全局默认配置
general:
  onebot.v12:
    use_http: true        # 启用 HTTP API
    use_ws: false         # 启用 WebSocket
    use_ws_reverse: false # 启用反向 WebSocket

# 账号配置
wechat.my_mp:
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: "your_token"
```

## 通信方式

### HTTP API

**地址格式**: `http://localhost:6727/{platform}/{account_id}/onebot/v12/{action}`

**示例**:
```bash
# 发送消息
curl -X POST http://localhost:6727/wechat/my_mp/onebot/v12/send_message \
  -H "Content-Type: application/json" \
  -d '{
    "detail_type": "private",
    "user_id": "123456",
    "message": [
      {"type": "text", "data": {"text": "Hello"}}
    ]
  }'
```

### WebSocket

**地址格式**: `ws://localhost:6727/{platform}/{account_id}/onebot/v12`

### 反向 WebSocket

```yaml
wechat.my_mp:
  onebot.v12:
    use_ws_reverse: true
    ws_reverse_url: "ws://your-server:8080/ws"
```

## 消息格式

OneBot V12 使用统一的消息段数组格式：

```json
[
  {
    "type": "text",
    "data": {"text": "Hello "}
  },
  {
    "type": "mention",
    "data": {"user_id": "123456"}
  },
  {
    "type": "image",
    "data": {"file_id": "xxx"}
  }
]
```

详细说明请参考 [OneBot V12 消息段文档](/protocol/onebot-v12/segment)。

## API 列表

OneBot V12 的 API 更加统一和规范：

- `send_message` - 发送消息（统一接口）
- `delete_message` - 撤回消息
- `get_self_info` - 获取机器人自身信息
- `get_user_info` - 获取用户信息
- `get_group_info` - 获取群组信息
- `get_group_member_list` - 获取群成员列表

完整 API 请参考 [OneBot V12 API 文档](/protocol/onebot-v12/action)。

## 事件类型

OneBot V12 采用更清晰的事件分类：

- **消息事件**: `message`
  - `message.private` - 私聊消息
  - `message.group` - 群消息
  - `message.channel` - 频道消息
  
- **通知事件**: `notice`
  - `notice.friend_increase` - 好友增加
  - `notice.group_member_increase` - 群成员增加
  
- **请求事件**: `request`
  - `request.friend` - 加好友请求
  - `request.group` - 加群请求

详细说明请参考 [OneBot V12 事件文档](/protocol/onebot-v12/event)。

## V11 vs V12

### 主要差异

| 特性 | V11 | V12 |
|------|-----|-----|
| 消息格式 | CQ 码字符串 | JSON 消息段数组 |
| API 命名 | `send_private_msg` | `send_message` |
| 平台标识 | 无 | 统一的平台字段 |
| 错误处理 | 简单状态码 | 详细错误信息 |

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

### 迁移建议

对于新项目，推荐直接使用 V12。现有 V11 项目可以逐步迁移，onebots 支持同时提供两个版本的协议。

## 迁移指南

### 从 V11 迁移到 V12

#### 1. 更新配置

```yaml
# V11
general:
  onebot.v11:
    use_http: true
    http_reverse:
      - http://localhost:5000/onebot

# V12
general:
  onebot.v12:
    use_http: true
    webhook:  # 注意：改名为 webhook
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

## 特性

- ✅ 完整的 OneBot 12 API 实现
- ✅ 统一的消息段格式
- ✅ 原生支持频道/公会
- ✅ 字符串ID（更好的跨平台兼容性）
- ✅ 事件过滤器支持
- ✅ 多种通信方式

## 平台支持

本实现支持所有实现了 Adapter 接口的平台，包括但不限于：

- QQ（官方机器人）
- 微信
- Kook
- Discord
- 其他自定义平台

不同平台对 OneBot V12 标准的支持程度可能不同，某些 API 或事件可能不可用。

## 使用客户端SDK

onebots 提供了 imhelper 客户端SDK，可以方便地连接 OneBot V12 协议：

### 安装

```bash
npm install imhelper @imhelper/onebot-v12
```

### 使用示例

```typescript
import { createImHelper } from 'imhelper';
import { createOnebot12Adapter } from '@imhelper/onebot-v12';

// 创建适配器
const adapter = createOnebot12Adapter({
  baseUrl: 'http://localhost:6727',
  selfId: 'zhin',
  accessToken: 'your_token',
  receiveMode: 'ws',
  path: '/kook/zhin/onebot/v12',
  wsUrl: 'ws://localhost:6727/kook/zhin/onebot/v12',
  platform: 'kook',
});

// 创建 ImHelper 实例
const helper = createImHelper(adapter);

// 监听消息事件
helper.on('message.private', (message) => {
  console.log('收到私聊消息:', message.content);
  message.reply([{ type: 'text', data: { text: '收到！' } }]);
});

// 连接
await adapter.connect();

// 发送消息
await helper.sendPrivateMessage('123456', [
  { type: 'text', data: { text: 'Hello!' } }
]);
```

详细说明请查看：[客户端SDK使用指南](/guide/client-sdk)

## 支持的框架

目前支持 OneBot V12 的框架：

- [Koishi](https://koishi.chat/) - v4.10.0+
- [NoneBot2](https://nonebot.dev/) - 通过适配器支持
- 其他框架陆续支持中

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

```yaml
general:
  onebot.v12:
    filters:
      type: message
      detail_type: group
      group_id: ["123456", "789012"]
```

## 相关链接

- [OneBot V12 标准](https://github.com/botuniverse/onebot-v12)
- [@onebots/protocol-onebot-v12 README](https://github.com/lc-cn/onebots/tree/master/packages/protocol-onebot-v12)
- [配置说明](/config/protocol/onebot-v12)
- [从 V11 迁移](https://12.onebot.dev/guide/migration/)
- [客户端SDK使用指南](/guide/client-sdk)
