# AlemonJS

AlemonJS 已进入 OneBots Application 运行时模型。启动时通过 `-t alemonjs` 激活，Application 会被应用到每个协议实例，并公开连接、动作、路由和限制。

## 启动

```bash
onebots -r <adapter> -p onebot-v11 -t alemonjs -c config.yaml
```

也可以持久化：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [alemonjs]
```

## 连接能力

| 项目 | 当前值 |
| --- | --- |
| Application | `alemonjs` |
| 协议 | `onebot.v11` |
| 连接方式 | `websocket` |
| 固定门禁 | `2.1.103 / adapter 2.1.21` |

运行时状态可通过 `GET /api/applications` 查询。未匹配 `onebot.v11` 的已注册协议会明确显示为 `unsupported`，不会被伪装为兼容。

## 限制

当前门禁覆盖握手、私聊事件和基础身份/发送动作；完整群聊、富媒体与重连矩阵仍需继续验证。

完整的生成配置和审计证据仍可在[框架总览](/solution/frameworks)中查看。
