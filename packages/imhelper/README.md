# imhelper

IMHelper 客户端SDK核心，提供统一的客户端接口和接收器，用于连接标准协议（OneBot V11/V12、Satori、Milky）和机器人框架。

## 简介

`imhelper` 是 onebots 项目的客户端SDK核心包，提供统一的接口来连接标准协议和机器人框架，抹平不同协议的差异。无论你使用哪种协议（OneBot V11/V12、Satori、Milky），都可以使用相同的 API。

## 特性

- 🎯 **统一接口** - 无论使用哪种协议，都使用相同的 API
- 📡 **多种接收方式** - 支持 WebSocket、WSS、Webhook、SSE 等多种事件接收方式
- 🔒 **类型安全** - 完整的 TypeScript 类型支持
- 🎨 **事件驱动** - 基于 EventEmitter 的事件系统
- 🔌 **易于扩展** - 清晰的适配器接口，易于实现新的协议客户端

## 架构位置

```
平台 API (微信、QQ、钉钉...)
        ↓
    onebots (服务端) ← 本项目服务端
        ↓
标准协议 (OneBot、Satori...)
        ↓
    imhelper (客户端SDK) ← 本项目客户端
        ↓
机器人框架 (Koishi、NoneBot...)
```

## 安装

```bash
npm install imhelper
# 或
pnpm add imhelper
```

## 快速开始

### 1. 安装协议客户端包

根据你要连接的协议，安装对应的客户端包：

```bash
# OneBot V11 客户端
npm install @imhelper/onebot-v11

# OneBot V12 客户端
npm install @imhelper/onebot-v12

# Satori 客户端
npm install @imhelper/satori-v1

# Milky 客户端
npm install @imhelper/milky-v1
```

### 2. 创建适配器

```typescript
import { createOnebot11Adapter } from '@imhelper/onebot-v11';

const adapter = createOnebot11Adapter({
  baseUrl: 'http://localhost:6727',
  selfId: 'zhin',
  accessToken: 'your_token',
  receiveMode: 'ws', // 'ws' | 'wss' | 'webhook' | 'sse'
  path: '/kook/zhin/onebot/v11',
  wsUrl: 'ws://localhost:6727/kook/zhin/onebot/v11',
  platform: 'kook',
});
```

### 3. 创建 ImHelper 实例

```typescript
import { createImHelper } from 'imhelper';

const helper = createImHelper(adapter);
```

### 4. 监听事件

```typescript
// 监听私聊消息
helper.on('message.private', (message) => {
  console.log('收到私聊消息:', message.content);
  // 自动回复
  message.reply('收到！');
});

// 监听群聊消息
helper.on('message.group', (message) => {
  console.log('收到群聊消息:', message.content);
});

// 监听频道消息
helper.on('message.channel', (message) => {
  console.log('收到频道消息:', message.content);
});
```

### 5. 启动连接

```typescript
// 启动适配器（Webhook 模式需要指定端口）
await helper.start(8080);

// 或者使用默认端口
await helper.start();
```

## API 文档

### ImHelper

主要的客户端类，提供统一的消息处理接口。

#### 方法

- `sendPrivateMessage(userId, message)` - 发送私聊消息
- `sendGroupMessage(groupId, message)` - 发送群聊消息
- `sendChannelMessage(channelId, message)` - 发送频道消息
- `pickUser(userId)` - 获取用户对象
- `pickGroup(groupId)` - 获取群组对象
- `pickChannel(channelId)` - 获取频道对象
- `start(port?)` - 启动适配器
- `stop()` - 停止适配器

#### 事件

- `message.private` - 私聊消息事件
- `message.group` - 群聊消息事件
- `message.channel` - 频道消息事件
- `event` - 原始事件

### Message

消息对象，包含消息的所有信息。

#### 属性

- `id` - 消息ID
- `scene_type` - 场景类型（'private' | 'group' | 'channel'）
- `scene_id` - 场景ID
- `content` - 消息内容
- `sender` - 发送者（User 对象）
- `time` - 时间戳

#### 方法

- `reply(message)` - 回复消息

### User

用户对象，表示消息发送者或其他用户。

#### 方法

- `send(message)` - 向该用户发送消息

### Group

群组对象，表示群聊。

#### 方法

- `send(message)` - 在群组中发送消息

### Channel

频道对象，表示频道。

#### 方法

- `send(message)` - 在频道中发送消息

## 接收器 (Receivers)

imhelper 支持多种事件接收方式：

### WebSocket Receiver

实时事件接收，支持自动重连。

```typescript
import { WSReceiver } from 'imhelper';

const receiver = new WSReceiver({
  url: 'ws://localhost:6727/kook/zhin/onebot/v11',
  accessToken: 'your_token',
});
```

### WSS Receiver

安全 WebSocket，TLS 加密。

```typescript
import { WSSReceiver } from 'imhelper';

const receiver = new WSSReceiver({
  url: 'wss://example.com/kook/zhin/onebot/v11',
  accessToken: 'your_token',
});
```

### Webhook Receiver

HTTP 服务器，接收服务端推送的事件。

```typescript
import { WebhookReceiver } from 'imhelper';

const receiver = new WebhookReceiver({
  path: '/webhook',
  accessToken: 'your_token',
  port: 8080, // 可选，默认 8080
});
```

### SSE Receiver

Server-Sent Events，长连接事件接收。

```typescript
import { SSEReceiver } from 'imhelper';

const receiver = new SSEReceiver({
  url: 'http://localhost:6727/kook/zhin/onebot/v11/sse',
  accessToken: 'your_token',
});
```

## 完整示例

```typescript
import { createImHelper } from 'imhelper';
import { createOnebot11Adapter } from '@imhelper/onebot-v11';

// 创建适配器
const adapter = createOnebot11Adapter({
  baseUrl: 'http://localhost:6727',
  selfId: 'zhin',
  accessToken: 'your_token',
  receiveMode: 'ws',
  path: '/kook/zhin/onebot/v11',
  wsUrl: 'ws://localhost:6727/kook/zhin/onebot/v11',
  platform: 'kook',
});

// 创建 ImHelper 实例
const helper = createImHelper(adapter);

// 监听私聊消息
helper.on('message.private', async (message) => {
  console.log(`收到来自 ${message.sender.id} 的消息: ${message.content}`);
  
  // 自动回复
  await message.reply('已收到您的消息！');
});

// 监听群聊消息
helper.on('message.group', async (message) => {
  if (message.content === 'ping') {
    await message.reply('pong');
  }
});

// 启动
await helper.start();

console.log('ImHelper 已启动');
```

## 支持的协议

- ✅ **OneBot V11** - 通过 `@imhelper/onebot-v11`
- ✅ **OneBot V12** - 通过 `@imhelper/onebot-v12`
- ✅ **Satori V1** - 通过 `@imhelper/satori-v1`
- ✅ **Milky V1** - 通过 `@imhelper/milky-v1`

## 相关链接

- [完整文档](https://onebots.pages.dev/guide/client-sdk)
- [快速开始](https://onebots.pages.dev/guide/start)
- [GitHub 仓库](https://github.com/lc-cn/onebots)

## License

MIT

