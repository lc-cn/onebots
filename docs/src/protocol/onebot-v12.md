# OneBot V12 协议

OneBot V12 是 OneBot 协议的下一代版本，提供了更现代化、更灵活的机器人接口标准。

## 协议简介

OneBot V12 相比 V11 的改进：

- 更规范的消息段格式（替代 CQ 码）
- 更完善的类型系统
- 跨平台特性支持
- 更好的扩展性
- 标准化的错误处理

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

## 消息段

OneBot V12 使用标准化的消息段格式：

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

详细说明请参考 [OneBot V12 消息段文档](/v12/segment)。

## API 列表

OneBot V12 的 API 更加统一和规范：

- `send_message` - 发送消息（统一接口）
- `delete_message` - 撤回消息
- `get_self_info` - 获取机器人自身信息
- `get_user_info` - 获取用户信息
- `get_group_info` - 获取群组信息
- `get_group_member_list` - 获取群成员列表

完整 API 请参考 [OneBot V12 API 文档](/v12/action)。

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

详细说明请参考 [OneBot V12 事件文档](/v12/event)。

## V11 vs V12

### 主要差异

| 特性 | V11 | V12 |
|------|-----|-----|
| 消息格式 | CQ 码字符串 | JSON 消息段数组 |
| API 命名 | `send_private_msg` | `send_message` |
| 平台标识 | 无 | 统一的平台字段 |
| 错误处理 | 简单状态码 | 详细错误信息 |

### 迁移建议

对于新项目，推荐直接使用 V12。现有 V11 项目可以逐步迁移，OneBots 支持同时提供两个版本的协议。

## 支持的框架

目前支持 OneBot V12 的框架：

- [Koishi](https://koishi.chat/) - v4.10.0+
- [NoneBot2](https://nonebot.dev/) - 通过适配器支持
- 其他框架陆续支持中

## 相关链接

- [OneBot V12 标准](https://github.com/botuniverse/onebot-12)
- [@onebots/protocol-onebot-v12 README](https://github.com/lc-cn/onebots/tree/master/packages/protocol-onebot-v12)
- [配置说明](/config/v12)
- [从 V11 迁移](https://12.onebot.dev/guide/migration/)
