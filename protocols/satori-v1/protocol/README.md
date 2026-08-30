# @onebots/protocol-satori-v1

onebots Satori V1 协议实现 - 支持 Satori 协议的插件

## 简介

`@onebots/protocol-satori-v1` 是 onebots 框架的官方 Satori 协议实现。Satori 是一个现代化的跨平台机器人协议，专注于提供统一的消息格式和事件系统。

## 特性

- ✅ **Satori 协议** - 完整实现 Satori V1 规范
- 🔌 **多通信方式** - HTTP、WebSocket、多个 Webhook
- 🔐 **安全认证** - 支持 Token 认证
- 📨 **消息元素** - 使用消息元素(Elements)表示消息
- 🎯 **跨平台** - 统一的跨平台设计
- 🔄 **事件系统** - 标准化的事件格式

## 安装

```bash
npm install @onebots/protocol-satori-v1
# 或
pnpm add @onebots/protocol-satori-v1
```

## 使用方法

> **重要：** 协议必须先注册才能使用。即使在配置文件中配置了 `satori.v1` 协议，如果没有注册该协议，配置也不会生效。

### 1. 命令行注册（推荐）

使用 `onebots` 命令行工具时，通过 `-p` 参数注册协议：

```bash
# 注册 Satori V1 协议
onebots -p satori-v1

# 同时注册多个协议
onebots -p satori-v1 -p onebot-v11 -p onebot-v12

# 注册协议并指定适配器
onebots -r wechat -p satori-v1 -c config.yaml
```

协议会自动从以下位置加载：

- `@onebots/protocol-satori-v1` (官方包)
- `onebots-protocol-satori-v1` (社区包)
- `satori-v1` (直接包名)

### 2. 配置文件方式

```yaml
accounts:
  - platform: wechat
    account_id: my_account
    protocol: satori.v1

    # Satori V1 配置
    use_http: true              # 启用 HTTP API
    use_ws: true                # 启用 WebSocket
    token: your_token           # 访问令牌
    platform: wechat            # 平台名称

    # Webhook 配置
    webhooks:
      - url: http://localhost:5703/satori
        token: webhook_token
```

### 3. 代码方式

```typescript
import { App } from "onebots";
import { SatoriV1 } from "@onebots/protocol-satori-v1";

// 注册协议
await App.registerProtocol("satori", SatoriV1, "v1");

// 创建应用
const app = new App();
await app.start();
```

## 配置参数

### 通信方式

| 参数       | 类型    | 默认值 | 说明           |
| ---------- | ------- | ------ | -------------- |
| `use_http` | boolean | -      | 启用 HTTP API  |
| `use_ws`   | boolean | -      | 启用 WebSocket |
| `webhooks` | array   | []     | Webhook 配置   |

### 认证配置

| 参数       | 类型   | 默认值   | 说明           |
| ---------- | ------ | -------- | -------------- |
| `token`    | string | -        | 访问令牌(全局) |
| `platform` | string | "satori" | 平台名称       |

### Webhook 配置

```typescript
{
  url: string;          // Webhook 地址
  token?: string;       // 访问令牌(覆盖全局)
}
```

## 通信方式

### HTTP API

访问地址：

```
http://host:port/{platform}/{account_id}/satori/v1/{endpoint}
```

请求示例：

```bash
curl -X POST http://localhost:6727/wechat/my_account/satori/v1/message.create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "channel_id": "channel_123",
    "content": "Hello, World!"
  }'
```

### WebSocket

连接地址：

```
ws://host:port/{platform}/{account_id}/satori/v1/events
```

认证：

```json
{
  "op": 3,
  "body": {
    "token": "your_token"
  }
}
```

## API 列表

HTTP 动作名只接受 Satori 规范的 `resource.method` 形式，不提供 camelCase 别名。

### 消息 API

- `message.create` - 发送消息
- `message.get` - 获取消息
- `message.delete` - 删除消息
- `message.update` - 更新消息
- `message.list` - 获取消息列表

### 频道 API

- `channel.get` - 获取频道
- `channel.list` - 获取频道列表
- `channel.create` - 创建频道
- `channel.update` - 更新频道
- `channel.delete` - 删除频道

### 群组 API

- `guild.get` - 获取群组
- `guild.list` - 获取群组列表

### 群组成员 API

- `guild.member.get` - 获取群组成员
- `guild.member.list` - 获取群组成员列表
- `guild.member.kick` - 移除群组成员
- `guild.member.mute` - 设置成员禁言状态

### 用户 API

- `user.get` - 获取用户信息
- `user.channel.create` - 创建私聊频道

### 好友 API

- `friend.list` - 获取好友列表
- `friend.delete` - 删除好友

### 登录 API

- `login.get` - 获取当前机器人真实登录身份

### 反应 API

- `reaction.create` - 添加表态
- `reaction.delete` - 删除表态
- `reaction.clear` - 清除表态
- `reaction.list` - 获取表态列表

### 登录 API

- `login.get` - 获取登录信息
- `login.list` - 获取登录列表

## 消息元素

Satori 使用消息元素(Elements)表示消息：

### 文本

```html
Hello, World!
```

### 提及用户

```html
<at id="123456" />
```

### 提及所有人

```html
<at type="all" />
```

### 提及频道

```html
<sharp id="channel_id" />
```

### 图片

```html
<img src="http://example.com/image.jpg" />
```

### 语音

```html
<audio src="http://example.com/audio.mp3" />
```

### 视频

```html
<video src="http://example.com/video.mp4" />
```

### 文件

```html
<file src="http://example.com/file.pdf" />
```

### 引用消息

```html
<quote id="message_id" />
```

### 作者信息

```html
<author id="user_id" name="Username" />
```

### 按钮

```html
<button id="button_1">Click Me</button>
```

## 事件格式

### 消息事件

```json
{
  "id": 1,
  "type": "message-created",
  "platform": "wechat",
  "self_id": "bot_123",
  "timestamp": 1234567890000,
  "channel": {
    "id": "channel_123",
    "type": 0
  },
  "user": {
    "id": "user_456",
    "name": "Username"
  },
  "message": {
    "id": "msg_789",
    "content": "Hello",
    "created_at": 1234567890000
  }
}
```

### 群组成员事件

```json
{
  "id": 2,
  "type": "guild-member-added",
  "platform": "wechat",
  "self_id": "bot_123",
  "timestamp": 1234567890000,
  "guild": {
    "id": "guild_123",
    "name": "Guild Name"
  },
  "user": {
    "id": "user_456",
    "name": "Username"
  },
  "operator": {
    "id": "user_789",
    "name": "Operator"
  }
}
```

### 好友请求事件

```json
{
  "id": 3,
  "type": "friend-request",
  "platform": "wechat",
  "self_id": "bot_123",
  "timestamp": 1234567890000,
  "user": {
    "id": "user_456",
    "name": "Username"
  },
  "message": {
    "content": "我是xxx"
  }
}
```

## WebSocket 通信

### 客户端 -> 服务器

#### 认证(IDENTIFY)

```json
{
  "op": 3,
  "body": {
    "token": "your_token",
    "sequence": 0
  }
}
```

#### Ping

```json
{
  "op": 1
}
```

### 服务器 -> 客户端

#### 就绪(READY)

```json
{
  "op": 4,
  "body": {
    "logins": [
      {
        "self_id": "bot_123",
        "platform": "wechat",
        "status": 1
      }
    ]
}
```

#### 事件(EVENT)

```json
{
  "op": 0,
  "body": {
    "id": 1,
    "type": "message-created",
    "platform": "wechat",
    "self_id": "bot_123",
    "timestamp": 1234567890000,
    ...
  }
}
```

#### Pong

```json
{
  "op": 2
}
```

## 事件类型列表

### 消息事件

- `message-created` - 接收到消息
- `message-updated` - 消息被更新
- `message-deleted` - 消息被删除

### 反应事件

- `reaction-added` - 表态被添加
- `reaction-removed` - 表态被移除

### 群组事件

- `guild-added` - 加入群组
- `guild-updated` - 群组被更新
- `guild-removed` - 退出群组
- `guild-request` - 收到群组邀请

### 群组成员事件

- `guild-member-added` - 群组成员增加
- `guild-member-updated` - 群组成员信息更新
- `guild-member-removed` - 群组成员移除
- `guild-member-request` - 加群请求

### 好友事件

- `friend-request` - 收到好友请求

### 登录事件

- `login-added` - 登录被创建
- `login-removed` - 登录被删除
- `login-updated` - 登录信息更新

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build
```

## 相关链接

- [Satori 协议文档](https://satori.js.org/)
- [onebots 文档](../../docs)

## 许可证

MIT License - 查看 [LICENSE](../../LICENSE) 文件了解详情

## 作者

凉菜
