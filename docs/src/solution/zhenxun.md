# 真寻

真寻 已进入 OneBots Application 运行时模型。启动时通过 `-t zhenxun` 激活，Application 会被应用到每个协议实例，并公开连接、动作、路由和限制。

## 启动

```bash
onebots -r <adapter> -p onebot-v11 -t zhenxun -c config.yaml
```

也可以持久化：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [zhenxun]
```

## 连接能力

| 项目 | 当前值 |
| --- | --- |
| Application | `zhenxun` |
| 协议 | `onebot.v11` |
| 连接方式 | `reverse-websocket` |
| 固定门禁 | `source audit 39ed1ade` |

运行时状态可通过 `GET /api/applications` 查询。未匹配 `onebot.v11` 的已注册协议会明确显示为 `unsupported`，不会被伪装为兼容。

## 限制

核心源码审计动作均已覆盖，但第三方插件和完整进程尚未验证。

完整的生成配置和审计证据仍可在[框架总览](/solution/frameworks)中查看。
