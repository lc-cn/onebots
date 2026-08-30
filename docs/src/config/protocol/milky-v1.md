# Milky v1 配置

Milky 与其他协议共享 OneBots 的 HTTP Host。正向 HTTP 和 WebSocket 只需要开关；反向目标使用可动态增减的端点列表。

## 完整结构

```yaml
general:
  milky.v1:
    use_http: true
    use_ws: true
    access_token: global-token
    secret: webhook-signature-secret
    http_reverse:
      - url: https://bot.example/events
        access_token: downstream-token
        secret: endpoint-secret
        post_timeout: 5
    ws_reverse:
      - url: wss://bot.example/events
        access_token: downstream-token
        reconnect_interval: 5
    filters:
      event_type:
        - message_receive
        - friend_request

icqq.10001:
  milky.v1:
    use_ws: false
```

`general` 是协议默认值，`{platform}.{account_id}` 下的同名配置覆盖它。Web 管理端会根据协议 Schema 将反向端点和过滤器渲染为可增减表单，不需要手写 JSON。

## 字段

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `use_http` | `boolean` | `true` | 启用 `/api/{action}` |
| `use_ws` | `boolean` | `false` | 启用 `/event` 正向 WebSocket |
| `access_token` | `string` | - | HTTP、正向 WS 与反向连接的默认 Token |
| `secret` | `string` | - | HTTP 反向上报的默认 HMAC Secret |
| `http_reverse` | `Array<string | HttpReverseConfig>` | `[]` | HTTP 事件上报目标 |
| `ws_reverse` | `Array<string | WsReverseConfig>` | `[]` | OneBots 主动建立的 WS 连接 |
| `filters` | `EventFilter` | - | 事件过滤表达式 |

`use_http` 和 `use_ws` 不接受端口或 Host 对象。监听地址属于 OneBots 全局 Host；在协议配置内重复声明不会生效，因此不属于公开配置契约。

## 正向端点

| 传输 | 地址 |
| --- | --- |
| HTTP API | `POST /{platform}/{account_id}/milky/v1/api/{action}` |
| WebSocket | `GET /{platform}/{account_id}/milky/v1/event` |

HTTP 只接受 `application/json`。Token 优先从 `Authorization: Bearer <token>` 读取，也支持 `?access_token=`。

## HTTP 反向上报

```yaml
http_reverse:
  - url: https://bot.example/events
    access_token: endpoint-token
    secret: endpoint-secret
    post_timeout: 10
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `url` | `string` | 必填 | 仅允许 HTTP/HTTPS |
| `access_token` | `string` | 全局 Token | 作为 Bearer Token 发送 |
| `secret` | `string` | 全局 Secret | 生成 `X-Signature` |
| `post_timeout` | `number` | `5` | 请求超时，单位秒 |

上报还会携带 `User-Agent: Milky/1.0` 和 `X-Self-ID`。

## 反向 WebSocket

```yaml
ws_reverse:
  - url: wss://bot.example/events
    access_token: endpoint-token
    reconnect_interval: 5
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `url` | `string` | 必填 | 仅允许 WS/WSS |
| `access_token` | `string` | 全局 Token | 追加为查询参数 |
| `reconnect_interval` | `number` | `5` | 重连间隔，单位秒 |

反向连接支持接收 `{ action, params, echo? }` 动作请求，并在响应中保留 `echo`。

## 事件过滤

过滤器直接匹配 canonical Milky 事件，因此顶层字段应使用 `event_type`，消息场景使用 `data.message_scene`：

```yaml
filters:
  event_type: message_receive
  data:
    message_scene: group
```

复杂的任意/全部条件、嵌套字段和排除规则可在 Web 管理端可视化编辑。过滤器的通用语义见[协议配置](/config/protocol)。

## 相关链接

- [Milky v1 协议](/protocol/milky)
- [客户端 SDK 使用指南](/guide/client-sdk)
