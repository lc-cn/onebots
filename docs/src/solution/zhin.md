# Zhin

Zhin 已进入 OneBots Application 运行时模型。启动时通过 `-t zhin` 激活，Application 会被应用到每个协议实例，并公开连接、动作、路由和限制。

## 启动

```bash
onebots -r <adapter> -p onebot-v11 -t zhin -c config.yaml
```

也可以持久化：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [zhin]
```

## 连接能力

| 项目 | 当前值 |
| --- | --- |
| Application | `zhin` |
| 协议 | `onebot.v11` |
| 连接方式 | `websocket` |
| 固定门禁 | `6.0.15 / adapter 7.0.8` |

运行时状态可通过 `GET /api/applications` 查询。未匹配 `onebot.v11` 的已注册协议会明确显示为 `unsupported`，不会被伪装为兼容。

## Zhin 专用扩展

`@onebots/application-zhin` 是独立 npm 包。它为每个 OneBot 11 协议实例增加：

- `/<platform>/<account>/onebot/v11/applications/zhin` 专用正向 WebSocket；
- `get_zhin_application_info` 扩展动作；
- token 校验、生命周期事件、动作调用与事件投递；
- 管理 API 中可查询的连接和动作能力。

即使协议配置中的 `use_ws` 为 `false`，只要使用 `-t zhin`，专用 Zhin WebSocket 仍会启动。

## 限制

当前门禁覆盖握手、私聊事件和基础身份/发送动作；完整群聊、富媒体与重连矩阵仍需继续验证。

完整的生成配置和审计证据仍可在[框架总览](/solution/frameworks)中查看。
