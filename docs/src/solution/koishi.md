# Koishi

Koishi 已进入 OneBots Application 运行时模型。启动时通过 `-t koishi` 激活，Application 会被应用到每个协议实例，并公开连接、动作、路由和限制。

## 启动

```bash
onebots -r <adapter> -p satori-v1 -t koishi -c config.yaml
```

也可以持久化：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [satori-v1]
  applications: [koishi]
```

## 连接能力

| 项目 | 当前值 |
| --- | --- |
| Application | `koishi` |
| 协议 | `satori.v1` |
| 连接方式 | `websocket` |
| 固定门禁 | `4.18.6 / adapter 1.5.1` |

运行时状态可通过 `GET /api/applications` 查询。未匹配 `satori.v1` 的已注册协议会明确显示为 `unsupported`，不会被伪装为兼容。

## 限制

当前门禁覆盖握手、私聊事件和基础身份/发送动作；完整群聊、富媒体与重连矩阵仍需继续验证。

完整的生成配置和审计证据仍可在[框架总览](/solution/frameworks)中查看。
