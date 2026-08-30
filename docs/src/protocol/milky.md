# Milky v1 协议

Milky 是面向 QQ 机器人的开放协议。OneBots 按 Milky 的 `event_type` 事件模型、消息场景和 `/api/{action}` 动作接口提供服务，并通过 Adapter 能力层映射到实际平台。

## 安装与注册

```bash
pnpm add @onebots/protocol-milky-v1
onebots -r icqq -p milky-v1 -c config.yaml
```

SDK 客户端需要同时安装公共核心：

```bash
pnpm add imhelper @imhelper/milky-v1
```

## 配置

```yaml
general:
  milky.v1:
    use_http: true
    use_ws: true
    access_token: your-token

icqq.10001:
  milky.v1:
    filters:
      event_type:
        - message_receive
        - friend_request
```

`general` 提供默认值，账号级配置覆盖默认值。HTTP 反向上报、反向 WebSocket 和可视化过滤器见 [Milky 配置参考](/config/protocol/milky-v1)。

## 传输地址

| 用途 | 地址 |
| --- | --- |
| HTTP API | `POST /{platform}/{account_id}/milky/v1/api/{action}` |
| 正向 WebSocket | `GET /{platform}/{account_id}/milky/v1/event` |

HTTP 请求必须使用 `application/json`。Access Token 可通过 `Authorization: Bearer <token>` 或查询参数 `access_token` 传递。

### HTTP 调用

```bash
curl -X POST http://localhost:6727/icqq/10001/milky/v1/api/send_private_message \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your-token' \
  -d '{
    "user_id": 123456789,
    "message": [{ "type": "text", "data": { "text": "你好" } }]
  }'
```

成功与失败均返回结构化响应：

```json
{
  "status": "ok",
  "retcode": 0,
  "data": {}
}
```

未知动作返回 HTTP 404；不支持的 Content-Type 返回 415；鉴权失败返回 401。已识别动作的参数或平台失败通过 `status: "failed"`、`retcode` 和 `message` 表达。

### WebSocket

WebSocket 同时承载事件和动作请求。动作请求可以携带 `echo`，响应会原样返回它：

```json
{
  "action": "get_group_list",
  "params": {},
  "echo": "request-1"
}
```

## 事件模型

所有事件都使用统一 envelope：

```json
{
  "time": 1788080000,
  "self_id": 10001,
  "event_type": "message_receive",
  "data": {
    "message_scene": "group",
    "peer_id": 987654321,
    "message_seq": 42,
    "sender_id": 123456789,
    "time": 1788080000,
    "segments": [{ "type": "text", "data": { "text": "你好" } }]
  }
}
```

消息事件是 `event_type: "message_receive"`，场景由 `data.message_scene` 标识：`friend`、`group` 或 `temp`。申请事件使用 `friend_request`、`group_join_request`、`group_invited_join_request`；可表达的通知与机器人离线事件也保持各自 canonical `event_type`。原始事件不会改写成 OneBot 的 `post_type/message_type`。

## 动作能力

OneBots 提供当前 Adapter 能力可实现的 Milky 动作，主要包括：

- 消息：发送、撤回、查询、历史、合并转发、已读和临时资源 URL
- 目录：登录信息、实现信息、状态、好友、群和群成员
- 群管理：邀请好友、踢人、禁言、管理员、名片、群名、头像、公告、精华和 reaction
- 申请：好友申请、入群申请与群邀请的查询、同意和拒绝
- 文件：私聊/群文件上传、下载、移动、重命名、持久化与文件夹管理
- 账号扩展：资料修改、好友删除、自定义表情 URL、置顶会话等

动作已在协议中声明但当前平台不支持时返回明确失败，不伪造空结果。完整清单与参数以 [Milky 服务端 README](https://github.com/lc-cn/onebots/tree/master/protocols/milky-v1/protocol) 和运行中实例为准。

## 客户端 SDK

```typescript
import { createMilkyClient } from '@imhelper/milky-v1';

const client = createMilkyClient({
  baseUrl: 'http://localhost:6727/icqq/10001/milky/v1',
  selfId: '10001',
  accessToken: 'your-token',
  receiveMode: 'ws',
});

client.on('message.private', async message => {
  await message.reply('收到！');
});

client.on('event', event => {
  if (event.event_type === 'friend_request') console.log(event.data);
});

await client.start();
```

SDK 会从 `baseUrl` 自动派生 `/event`，API 自动使用 `/api/{action}`。已有 HTTP/WS Host 可使用 `receiveMode: 'manual'` 和 `ingest()`、`acceptHttp()`、`acceptWebSocket()`，详细说明见[客户端 SDK 使用指南](/guide/client-sdk)。

## 相关链接

- [Milky 官方协议](https://milky.ntqqrev.org/)
- [Milky 配置参考](/config/protocol/milky-v1)
- [客户端 SDK 使用指南](/guide/client-sdk)
