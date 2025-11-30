# OneBot V11 协议

OneBot V11 是一个广泛使用的聊天机器人应用接口标准，被众多机器人框架支持。

## 协议简介

OneBot V11（原 CQHTTP）是目前最流行的机器人协议标准之一，提供：

- 统一的消息格式（CQ 码）
- 完整的 API 接口
- 事件推送机制
- HTTP 和 WebSocket 通信方式

## 安装

```bash
npm install @onebots/protocol-onebot-v11
```

## 配置

在 `config.yaml` 中配置 OneBot V11 协议：

```yaml
# 全局默认配置
general:
  onebot.v11:
    use_http: true        # 启用 HTTP API
    use_ws: false         # 启用 WebSocket
    use_ws_reverse: false # 启用反向 WebSocket
    
# 账号配置
wechat.my_mp:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: "your_token"  # API 访问令牌（可选）
```

## 通信方式

### HTTP API

**地址格式**: `http://localhost:6727/{platform}/{account_id}/onebot/v11/{action}`

**示例**:
```bash
# 发送私聊消息
curl -X POST http://localhost:6727/wechat/my_mp/onebot/v11/send_private_msg \
  -H "Content-Type: application/json" \
  -d '{"user_id": "123456", "message": "Hello"}'
```

### WebSocket

**地址格式**: `ws://localhost:6727/{platform}/{account_id}/onebot/v11`

客户端连接后可接收事件推送，并通过 WebSocket 调用 API。

### 反向 WebSocket

OneBots 主动连接到指定的 WebSocket 服务器。

配置示例：
```yaml
wechat.my_mp:
  onebot.v11:
    use_ws_reverse: true
    ws_reverse_url: "ws://your-server:8080/ws"
```

## CQ 码

OneBot V11 使用 CQ 码表示富文本消息：

```
[CQ:face,id=123]           # 表情
[CQ:image,file=xxx.jpg]    # 图片
[CQ:at,qq=123456]          # @某人
```

详细说明请参考 [CQ 码文档](/v11/cqcode)。

## API 列表

常用 API：

- `send_private_msg` - 发送私聊消息
- `send_group_msg` - 发送群消息
- `get_login_info` - 获取登录号信息
- `get_stranger_info` - 获取陌生人信息
- `get_group_list` - 获取群列表

完整 API 请参考 [OneBot V11 API 文档](/v11/action)。

## 事件类型

OneBot V11 支持的事件：

- **消息事件**: `message.private`、`message.group`
- **通知事件**: `notice.group_upload`、`notice.friend_add`
- **请求事件**: `request.friend`、`request.group`
- **元事件**: `meta_event.lifecycle`、`meta_event.heartbeat`

详细说明请参考 [OneBot V11 事件文档](/v11/event)。

## 支持的框架

以下机器人框架原生支持 OneBot V11：

- [Koishi](https://koishi.chat/) - 跨平台机器人框架
- [NoneBot2](https://nonebot.dev/) - Python 异步机器人框架
- [Yunzai-Bot](https://github.com/yoimiya-kokomi/Yunzai-Bot) - QQ 机器人框架
- [ZeroBot](https://github.com/wdvxdr1123/ZeroBot) - Go 语言机器人框架

## 相关链接

- [OneBot V11 标准](https://github.com/botuniverse/onebot-11)
- [@onebots/protocol-onebot-v11 README](https://github.com/lc-cn/onebots/tree/master/packages/protocol-onebot-v11)
- [配置说明](/config/v11)
