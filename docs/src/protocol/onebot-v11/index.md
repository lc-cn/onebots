# OneBot V11 协议

OneBot V11 是一个广泛使用的聊天机器人应用接口标准，被众多机器人框架支持。

## 协议简介

OneBot V11（原 CQHTTP）是目前最流行的机器人协议标准之一，提供：

- 统一的消息格式（CQ 码）
- 完整的 API 接口
- 事件推送机制
- HTTP 和 WebSocket 通信方式

## 标准参考

- 官方仓库：https://github.com/botuniverse/onebot-v11
- 官方文档：https://11.onebot.dev

## 文档导航

- [动作 (Action)](/protocol/onebot-v11/action) - API 接口文档
- [事件 (Event)](/protocol/onebot-v11/event) - 事件类型文档
- [CQ码 (CQ Code)](/protocol/onebot-v11/cqcode) - 消息段格式文档

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

onebots 主动连接到指定的 WebSocket 服务器。

配置示例：
```yaml
wechat.my_mp:
  onebot.v11:
    use_ws_reverse: true
    ws_reverse_url: "ws://your-server:8080/ws"
```

## 消息格式

支持两种消息格式：

- **字符串格式 (CQ码)**：`[CQ:type,param1=value1,param2=value2]`
- **数组格式**：`[{type: "type", data: {param1: "value1"}}]`

### CQ 码示例

```
[CQ:face,id=123]           # 表情
[CQ:image,file=xxx.jpg]    # 图片
[CQ:at,qq=123456]          # @某人
```

详细说明请参考 [CQ 码文档](/protocol/onebot-v11/cqcode)。

## API 列表

常用 API：

- `send_private_msg` - 发送私聊消息
- `send_group_msg` - 发送群消息
- `get_login_info` - 获取登录号信息
- `get_stranger_info` - 获取陌生人信息
- `get_group_list` - 获取群列表

完整 API 请参考 [OneBot V11 API 文档](/protocol/onebot-v11/action)。

## 事件类型

OneBot V11 支持的事件：

- **消息事件**: `message.private`、`message.group`
- **通知事件**: `notice.group_upload`、`notice.friend_add`
- **请求事件**: `request.friend`、`request.group`
- **元事件**: `meta_event.lifecycle`、`meta_event.heartbeat`

详细说明请参考 [OneBot V11 事件文档](/protocol/onebot-v11/event)。

## 特性

- ✅ 完整的 OneBot 11 API 实现
- ✅ 支持所有标准消息段类型
- ✅ CQ 码自动解析和生成
- ✅ 消息 ID 自动转换（字符串 ↔ 整数）
- ✅ 事件过滤器支持
- ✅ 多种通信方式

## 平台支持

本实现支持所有实现了 Adapter 接口的平台，包括但不限于：

- QQ（官方机器人）
- 微信
- Kook
- Discord
- 其他自定义平台

不同平台对 OneBot V11 标准的支持程度可能不同，某些 API 或事件可能不可用。

## 使用客户端SDK

onebots 提供了 imhelper 客户端SDK，可以方便地连接 OneBot V11 协议：

### 安装

```bash
npm install imhelper @imhelper/onebot-v11
```

### 使用示例

```typescript
import { createImHelper } from 'imhelper';
import { createOnebot11Adapter } from '@imhelper/onebot-v11';

// 创建适配器
const adapter = createOnebot11Adapter({
  baseUrl: 'http://localhost:6727',
  selfId: 'zhin',
  accessToken: 'your_token',
  receiveMode: 'ws', // 'ws' | 'wss' | 'webhook' | 'sse'
  path: '/kook/zhin/onebot/v11',
  wsUrl: 'ws://localhost:6727/kook/zhin/onebot/v11',
  platform: 'kook',
});

// 创建 ImHelper 实例
const helper = createImHelper(adapter);

// 监听消息事件
helper.on('message.private', (message) => {
  console.log('收到私聊消息:', message.content);
  message.reply('收到！');
});

// 连接
await adapter.connect();

// 发送消息
await helper.sendPrivateMessage('123456', 'Hello!');
```

详细说明请查看：[客户端SDK使用指南](/guide/client-sdk)

## 支持的框架

以下机器人框架原生支持 OneBot V11：

- [Koishi](https://koishi.chat/) - 跨平台机器人框架
- [NoneBot2](https://nonebot.dev/) - Python 异步机器人框架
- [Yunzai-Bot](https://github.com/yoimiya-kokomi/Yunzai-Bot) - QQ 机器人框架
- [ZeroBot](https://github.com/wdvxdr1123/ZeroBot) - Go 语言机器人框架

## 相关链接

- [OneBot V11 标准](https://github.com/botuniverse/onebot-v11)
- [@onebots/protocol-onebot-v11 README](https://github.com/lc-cn/onebots/tree/master/packages/protocol-onebot-v11)
- [配置说明](/config/protocol/onebot-v11)
- [客户端SDK使用指南](/guide/client-sdk)
