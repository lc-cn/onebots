# @onebots/protocol-onebot-v12

onebots OneBot V12 协议实现 - 支持 OneBot 12 标准的协议插件

## 简介

`@onebots/protocol-onebot-v12` 是 onebots 框架的官方 OneBot V12 协议实现，完全兼容 [OneBot 12 标准](https://12.onebot.dev)，提供更现代化和标准化的机器人通信协议。

## 特性

- ✅ **OneBot 12 标准** - 完整实现 OneBot 12 规范
- 🔌 **多通信方式** - HTTP、WebSocket、HTTP Webhook、WebSocket Reverse
- 🔐 **安全认证** - 支持 Access Token 认证
- 📨 **消息段** - 使用消息段(Segment)代替 CQ 码
- 🎯 **跨平台** - 统一的跨平台消息格式
- 🔄 **事件系统** - 完善的事件分发机制

## 安装

```bash
npm install @onebots/protocol-onebot-v12
# 或
pnpm add @onebots/protocol-onebot-v12
```

## 使用方法

> **重要：** 协议必须先注册才能使用。即使在配置文件中配置了 `onebot.v12` 协议，如果没有注册该协议，配置也不会生效。

### 1. 命令行注册（推荐）

使用 `onebots` 命令行工具时，通过 `-p` 参数注册协议：

```bash
# 注册 OneBot V12 协议
onebots -p onebot-v12

# 同时注册多个协议
onebots -p onebot-v11 -p onebot-v12

# 注册协议并指定适配器和配置
onebots -r wechat -p onebot-v12 -c config.yaml
```

协议会自动从以下位置加载：

- `@onebots/protocol-onebot-v12` (官方包)
- `onebots-protocol-onebot-v12` (社区包)
- `onebot-v12` (直接包名)

### 2. 配置文件方式

```yaml
accounts:
  - platform: wechat
    account_id: my_account
    protocol: onebot.v12

    # OneBot V12 配置
    use_http: true # 启用 HTTP API
    use_ws: true # 启用 WebSocket
    access_token: your_token # 访问令牌
    heartbeat_interval: 15000 # 心跳间隔(ms)
    request_timeout: 15000 # 请求超时(ms)
    enable_cors: false # 启用 CORS

    # HTTP Webhook
    http_webhook:
      - http://localhost:5701/onebot/v12

    # WebSocket Reverse
    ws_reverse:
      - ws://localhost:6701/onebot/v12
```

### 3. 代码方式

```typescript
import { App } from "onebots";
import { OneBotV12Protocol } from "@onebots/protocol-onebot-v12";

// 注册协议
await App.registerProtocol("onebot", OneBotV12Protocol, "v12");

// 创建应用
const app = new App();
await app.start();
```

## 配置参数

### 通信方式

| 参数           | 类型     | 默认值 | 说明                   |
| -------------- | -------- | ------ | ---------------------- |
| `use_http`     | boolean  | true   | 启用 HTTP API          |
| `use_ws`       | boolean  | false  | 启用 WebSocket         |
| `http_webhook` | string[] | []     | HTTP Webhook 推送地址  |
| `ws_reverse`   | string[] | []     | WebSocket 反向连接地址 |

### 安全配置

| 参数           | 类型    | 默认值 | 说明      |
| -------------- | ------- | ------ | --------- |
| `access_token` | string  | -      | 访问令牌  |
| `enable_cors`  | boolean | false  | 启用 CORS |

### 其他配置

| 参数                 | 类型   | 默认值 | 说明         |
| -------------------- | ------ | ------ | ------------ |
| `heartbeat_interval` | number | -      | 心跳间隔(ms) |
| `request_timeout`    | number | 15000  | 请求超时(ms) |

## 通信方式

### HTTP API

访问地址：

```
http://host:port/{platform}/{account_id}/onebot/v12/{action}
```

请求示例：

```bash
curl -X POST http://localhost:6727/wechat/my_account/onebot/v12/send_message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "detail_type": "private",
    "user_id": "123456",
    "message": [
      {"type": "text", "data": {"text": "Hello"}}
    ]
  }'
```

响应格式：

```json
{
  "status": "ok",
  "retcode": 0,
  "data": {
    "message_id": "msg_123",
    "time": 1234567890
  },
  "message": ""
}
```

### WebSocket

连接地址：

```
ws://host:port/{platform}/{account_id}/onebot/v12
```

### HTTP Webhook

onebots 主动推送事件到配置的 HTTP Webhook 地址。

### WebSocket Reverse

onebots 主动连接到配置的 WebSocket 地址。

## API 列表

### 消息 API

- `send_message` - 发送消息
- `delete_message` - 撤回消息

### 获取信息 API

- `get_self_info` - 获取机器人自身信息
- `get_user_info` - 获取用户信息
- `get_friend_list` - 获取好友列表
- `get_group_info` - 获取群信息
- `get_group_list` - 获取群列表
- `get_group_member_info` - 获取群成员信息
- `get_group_member_list` - 获取群成员列表
- `get_guild_info` / `get_guild_list` - 获取频道服务器资料与列表
- `get_guild_member_info` / `get_guild_member_list` - 获取频道服务器成员
- `get_channel_info` / `get_channel_list` - 获取子频道资料与列表

### 文件 API

- `upload_file` - 上传文件
- `upload_file_fragmented` - 分片上传文件
- `get_file` - 获取文件

### 群组 API

- `set_group_name` - 设置群名称
- `leave_group` - 退出群组

### 扩展 API

- `invite_friend_to_group` - 邀请机器人好友加入群（OneBots 扩展）
- `accept_friend_request` - 同意好友申请（OneBots 扩展）
- `get_latest_events` - 获取最新事件列表
- `get_supported_actions` - 获取支持的动作列表
- `get_status` - 获取运行状态
- `get_version` - 获取版本信息

三个协议中的邀请扩展均使用相同参数：

```json
{
  "group_id": 123456789,
  "user_id": 987654321
}
```

两个字段必须为正整数。机器人需要是目标群成员，并具有平台侧允许邀请好友的权限。

同意好友申请时传入 `{ "flag": "..." }`，可选传入 `remark`。`flag` 必须原样取自对应好友申请事件，不能使用用户 ID 或自行生成的请求 ID 代替。

## 消息段(Segment)

OneBot 12 使用消息段代替 CQ 码：

### 文本

```json
{
  "type": "text",
  "data": {
    "text": "Hello, World!"
  }
}
```

### 提及(@)

```json
{
  "type": "mention",
  "data": {
    "user_id": "123456"
  }
}
```

### 提及所有人

```json
{
  "type": "mention_all"
}
```

### 图片

```json
{
  "type": "image",
  "data": {
    "file_id": "file_123"
  }
}
```

### 语音

```json
{
  "type": "voice",
  "data": {
    "file_id": "file_456"
  }
}
```

### 视频

```json
{
  "type": "video",
  "data": {
    "file_id": "file_789"
  }
}
```

### 文件

```json
{
  "type": "file",
  "data": {
    "file_id": "file_abc"
  }
}
```

### 位置

```json
{
  "type": "location",
  "data": {
    "latitude": 39.9042,
    "longitude": 116.4074,
    "title": "天安门",
    "content": "北京市东城区"
  }
}
```

### 回复

```json
{
  "type": "reply",
  "data": {
    "message_id": "msg_123"
  }
}
```

## 事件类型

### 消息事件

```json
{
  "id": "event_123",
  "time": 1234567890,
  "type": "message",
  "detail_type": "private",
  "sub_type": "",
  "self": {
    "platform": "wechat",
    "user_id": "bot_id"
  },
  "message_id": "msg_123",
  "message": [{ "type": "text", "data": { "text": "Hello" } }],
  "alt_message": "Hello",
  "user_id": "user_123"
}
```

### 通知事件

```json
{
  "id": "event_456",
  "time": 1234567890,
  "type": "notice",
  "detail_type": "group_member_increase",
  "sub_type": "join",
  "self": {
    "platform": "wechat",
    "user_id": "bot_id"
  },
  "group_id": "group_123",
  "user_id": "user_456",
  "operator_id": "user_789"
}
```

### 请求事件

```json
{
  "id": "event_789",
  "time": 1234567890,
  "type": "request",
  "detail_type": "friend",
  "sub_type": "",
  "self": {
    "platform": "wechat",
    "user_id": "bot_id"
  },
  "request_id": "req_123",
  "user_id": "user_123",
  "message": "我是xxx"
}
```

### 元事件

```json
{
  "id": "event_abc",
  "time": 1234567890,
  "type": "meta",
  "detail_type": "heartbeat",
  "sub_type": "",
  "self": {
    "platform": "wechat",
    "user_id": "bot_id"
  },
  "interval": 15000
}
```

## OneBot 11 vs 12 对比

| 特性     | OneBot 11     | OneBot 12                  |
| -------- | ------------- | -------------------------- |
| 消息格式 | CQ 码         | 消息段(Segment)            |
| 平台标识 | user_id(数字) | platform + user_id(字符串) |
| 事件格式 | post_type     | type + detail_type         |
| API 命名 | 下划线分隔    | 下划线分隔(更规范)         |
| 跨平台   | 主要支持 QQ   | 设计用于多平台             |

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build
```

## 相关链接

- [OneBot 12 标准](https://12.onebot.dev)
- [OneBot 12 GitHub](https://github.com/botuniverse/onebot-v12)
- [onebots 文档](../../docs)

## 许可证

MIT License - 查看 [LICENSE](../../LICENSE) 文件了解详情

## 作者

凉菜
