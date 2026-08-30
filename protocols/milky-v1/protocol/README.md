# @onebots/protocol-milky-v1

OneBots 的 Milky v1 服务端协议包。它把统一 `CommonEvent` 投影为 canonical Milky 事件，并把 Milky 动作严格翻译到 Adapter 能力层。

## 安装与注册

```bash
pnpm add @onebots/protocol-milky-v1
onebots -r icqq -p milky-v1 -c config.yaml
```

协议只有在应用注册后才会启动。CLI 会依次解析官方包、社区命名包和直接包名。

## 配置

```yaml
general:
  milky.v1:
    use_http: true
    use_ws: true
    access_token: global-token
    secret: webhook-signature-secret
    http_reverse:
      - url: https://bot.example/events
        access_token: endpoint-token
        secret: endpoint-secret
        post_timeout: 5
    ws_reverse:
      - url: wss://bot.example/events
        access_token: endpoint-token
        reconnect_interval: 5
    filters:
      event_type:
        - message_receive
        - friend_request
```

| 字段           | 类型           | 默认值  | 说明                            |
| -------------- | -------------- | ------- | ------------------------------- |
| `use_http`     | `boolean`      | `true`  | 启用 HTTP API                   |
| `use_ws`       | `boolean`      | `false` | 启用正向 WebSocket              |
| `access_token` | `string`       | -       | 正向与反向传输的默认 Token      |
| `secret`       | `string`       | -       | HTTP 反向上报的默认 HMAC Secret |
| `http_reverse` | endpoint array | `[]`    | HTTP 事件目标                   |
| `ws_reverse`   | endpoint array | `[]`    | OneBots 主动建立的 WS 连接      |
| `filters`      | event filter   | -       | canonical Milky 事件过滤器      |

`use_http` 和 `use_ws` 使用 OneBots 共享 Host，不接受协议级 Host 或端口对象。

## 传输

| 用途           | 地址                                                  |
| -------------- | ----------------------------------------------------- |
| HTTP API       | `POST /{platform}/{account_id}/milky/v1/api/{action}` |
| 正向 WebSocket | `GET /{platform}/{account_id}/milky/v1/event`         |

HTTP 只接受 `application/json`。Token 支持 `Authorization: Bearer <token>` 和查询参数 `access_token`。未知动作返回 404，不支持的 Content-Type 返回 415，鉴权失败返回 401。

```bash
curl -X POST http://localhost:6727/icqq/10001/milky/v1/api/send_private_message \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer global-token' \
  -d '{
    "user_id": 123456789,
    "message": [{ "type": "text", "data": { "text": "你好" } }]
  }'
```

正向与反向 WebSocket 都可接收 `{ action, params, echo? }`；响应保留 `echo`。HTTP 反向上报使用 `X-Signature: sha1=<hex>`，签名内容为原始请求体。

## 事件

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

消息使用 `event_type: "message_receive"`，场景来自 `data.message_scene`。申请使用 `friend_request`、`group_join_request`、`group_invited_join_request`；可表达的通知和机器人离线事件也保留 Milky 事件名。无法无损表达为 Milky 的 CommonEvent 不会伪装成其他事件。

## 动作

当前内置动作分为：

- 账号：资料修改、好友删除、自定义表情 URL、置顶会话
- 目录：登录、实现、状态、用户、好友、群、群成员与 QQ Web 凭据
- 消息：发送、撤回、查询、历史、合并转发、已读与临时资源 URL
- 群管理：邀请好友、踢人、禁言、管理员、名片、群名、头像、公告、精华和 reaction
- 申请：好友申请、入群申请和群邀请的查询、同意与拒绝
- 文件：上传、下载、浏览、移动、重命名、持久化、删除与文件夹管理

Adapter 可以通过 capability action seam 暴露额外动作。动作存在但当前平台不支持时返回明确的 Milky 失败响应，不会伪造空数据。

### 邀请好友入群

```bash
curl -X POST http://localhost:6727/icqq/10001/milky/v1/api/invite_friend_to_group \
  -H 'Content-Type: application/json' \
  -d '{"group_id":987654321,"user_id":123456789}'
```

### 处理好友申请

`initiator_uid` 必须原样取自 `friend_request` 事件：

```bash
curl -X POST http://localhost:6727/icqq/10001/milky/v1/api/accept_friend_request \
  -H 'Content-Type: application/json' \
  -d '{"initiator_uid":"opaque-uid","is_filtered":false}'
```

## 消息段

发送动作要求 `message` 为 Milky 消息段数组，不接受 CQ 码或自造字符串格式。当前 Adapter seam 可编译：

- `text`
- `mention` / `mention_all`
- `face`
- `reply`
- `image`
- `record`
- `video`
- `light_app`
- `xml`

字段遵循 Milky，例如图片、语音和视频使用 `uri`，回复使用 `message_seq`，提及用户使用 `user_id`。暂不能映射的发送段会明确失败；接收方向仅投影可表达的数据。

## 错误契约

响应统一为：

```json
{
  "status": "failed",
  "retcode": -404,
  "message": "Milky API unknown_action 不存在"
}
```

参数校验、未知动作、平台错误和未支持能力具有不同错误码与消息。成功响应使用 `status: "ok"`、`retcode: 0` 和可选 `data`。

## 相关链接

- [Milky 官方协议](https://milky.ntqqrev.org/)
- [OneBots Milky 文档](https://onebots.pages.dev/protocol/milky)
- [@imhelper/milky-v1](../sdk)

许可证：MIT
