# @onebots/protocol-milky-v1

onebots Milky V1 协议实现 - 支持 Milky 协议的插件

## 简介

`@onebots/protocol-milky-v1` 是 onebots 框架的官方 Milky V1 协议实现。Milky 是一个类似 OneBot 的 QQ 机器人协议，提供了不同的消息格式和 API 设计。

参考文档：https://milky.ntqqrev.org/

## 特性

- ✅ **Milky 协议** - 完整实现 Milky V1 规范
- 🔌 **多通信方式** - HTTP、WebSocket、HTTP Reverse、WebSocket Reverse
- 🔐 **安全认证** - 支持 HMAC 签名和 Token 认证
- 📨 **消息格式** - 支持字符串和数组两种消息格式
- 🎯 **事件过滤** - 灵活的事件过滤机制
- 🔄 **心跳机制** - 可配置的心跳间隔

## 安装

```bash
npm install @onebots/protocol-milky-v1
# 或
pnpm add @onebots/protocol-milky-v1
```

## 使用方法

> **重要：** 协议必须先注册才能使用。即使在配置文件中配置了 `milky.v1` 协议，如果没有注册该协议，配置也不会生效。

### 1. 命令行注册（推荐）

使用 `onebots` 命令行工具时，通过 `-p` 参数注册协议：

```bash
# 注册 Milky V1 协议
onebots -p milky-v1

# 同时注册多个协议
onebots -p milky-v1 -p onebot-v11 -p satori-v1

# 注册协议并指定适配器
onebots -r qq -p milky-v1 -c config.yaml
```

协议会自动从以下位置加载：
- `@onebots/protocol-milky-v1` (官方包)
- `onebots-protocol-milky-v1` (社区包)
- `milky-v1` (直接包名)

### 2. 配置文件方式

```yaml
accounts:
  - platform: qq
    account_id: my_qq
    protocol: milky.v1
    
    # Milky V1 配置
    use_http: true              # 启用 HTTP API
    use_ws: false               # 启用 WebSocket
    access_token: your_token    # 访问令牌
    secret: your_secret         # HMAC 签名密钥
    
    # HTTP Reverse
    http_reverse:
      - url: http://localhost:5702/milky
        timeout: 5000
    
    # WebSocket Reverse
    ws_reverse:
      - ws://localhost:6702/milky
```

### 3. 代码方式

```typescript
import { App } from 'onebots';
import { MilkyV1 } from '@onebots/protocol-milky-v1';

// 注册协议
await App.registerProtocol('milky', MilkyV1, 'v1');

// 创建应用
const app = new App();
await app.start();
```

## 配置参数

### 通信方式

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `use_http` | boolean | true | 启用 HTTP API |
| `use_ws` | boolean | false | 启用 WebSocket |
| `http_reverse` | array | [] | HTTP 反向推送配置 |
| `ws_reverse` | array | [] | WebSocket 反向连接配置 |

### 安全配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `access_token` | string | - | 访问令牌(全局) |
| `secret` | string | - | HMAC 签名密钥(全局) |

### HTTP Reverse 配置

```typescript
{
  url: string;          // 推送地址
  access_token?: string; // 访问令牌(覆盖全局)
  secret?: string;      // 签名密钥(覆盖全局)
  timeout?: number;     // 超时时间(ms)
}
```

## 通信方式

### HTTP API

访问地址：
```
http://host:port/{platform}/{account_id}/milky/v1/api/{action}
```

请求示例：
```bash
curl -X POST http://localhost:6727/qq/my_qq/milky/v1/api/send_private_message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "user_id": 123456,
    "message": [{ "type": "text", "data": { "text": "Hello" } }]
  }'
```

### WebSocket

连接地址：
```
ws://host:port/{platform}/{account_id}/milky/v1/event
```

### HTTP Reverse

onebots 主动推送事件到配置的 HTTP 地址，支持 HMAC 签名验证。

签名计算：
```
HMAC-SHA1(secret, body)
```

### WebSocket Reverse

onebots 主动连接到配置的 WebSocket 地址。

## API 列表

### 消息 API

- `send_private_message` - 发送私聊消息
- `send_group_message` - 发送群消息
- `recall_private_message` - 撤回私聊消息
- `recall_group_message` - 撤回群消息
- `get_message` - 获取消息

### 群组管理 API

- `kick_group_member` - 群组踢人
- `set_group_member_mute` - 群组成员禁言
- `set_group_member_admin` - 设置群管理员
- `set_group_member_card` - 设置群名片
- `set_group_name` - 设置群名
- `quit_group` - 退出群组

### 获取信息 API

- `get_login_info` - 获取登录号信息
- `get_user_profile` - 获取用户资料
- `get_friend_info` - 获取好友信息
- `get_friend_list` - 获取好友列表
- `get_group_info` - 获取群信息
- `get_group_list` - 获取群列表
- `get_group_member_info` - 获取群成员信息
- `get_group_member_list` - 获取群成员列表

### 其他 API

- `get_status` - 获取运行状态
- `get_version_info` - 获取版本信息

## 消息格式

### 字符串格式

```json
{
  "message": "纯文本消息"
}
```

### 数组格式

```json
{
  "message": [
    {
      "type": "text",
      "data": {
        "text": "Hello"
      }
    },
    {
      "type": "image",
      "data": {
        "file": "http://example.com/image.jpg"
      }
    }
  ]
}
```

## 消息段类型

### 文本

```json
{
  "type": "text",
  "data": {
    "text": "消息内容"
  }
}
```

### 图片

```json
{
  "type": "image",
  "data": {
    "file": "file://path/to/image.jpg"
  }
}
```

### 语音

```json
{
  "type": "record",
  "data": {
    "file": "file://path/to/audio.mp3"
  }
}
```

### @某人

```json
{
  "type": "at",
  "data": {
    "qq": "123456"
  }
}
```

### 回复

```json
{
  "type": "reply",
  "data": {
    "id": "message_id"
  }
}
```

## 事件类型

### 消息事件

```json
{
  "time": 1234567890,
  "self_id": 123456,
  "event_type": "message_receive",
  "data": {
    "message_scene": "friend",
    "peer_id": 789012,
    "message_seq": 123,
    "sender_id": 789012,
    "time": 1234567890,
    "segments": [{ "type": "text", "data": { "text": "Hello" } }],
    "friend": { "user_id": 789012, "nickname": "张三" }
  }
}
```

### 通知事件

```json
{
  "time": 1234567890,
  "self_id": 123456,
  "event_type": "group_member_increase",
  "data": {
    "group_id": 456789,
    "operator_id": 789012,
    "user_id": 345678
  }
}
```

### 请求事件

```json
{
  "time": 1234567890,
  "self_id": 123456,
  "event_type": "friend_request",
  "data": {
    "initiator_id": 789012,
    "initiator_uid": "uid_123",
    "comment": "我是xxx",
    "is_filtered": false
  }
}
```

## HMAC 签名验证

HTTP Reverse 支持 HMAC-SHA1 签名验证：

请求头：
```
X-Signature: sha1=<signature>
```

签名计算：
```javascript
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha1', secret)
  .update(body)
  .digest('hex');
```

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build
```

## 相关链接

- [Milky 协议文档](https://milky.ntqqrev.org/)
- [onebots 文档](../../docs)

## 许可证

MIT License - 查看 [LICENSE](../../LICENSE) 文件了解详情

## 作者

凉菜
