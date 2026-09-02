# Walle

Walle 已进入可激活的 OneBots Application 运行时，状态为 `experimental`。它会为匹配的 `onebot.v12` 协议实例公开连接能力、限制和 `get_walle_application_info` 兼容动作。

## 启动

```bash
onebots -r <adapter> -p onebot-v12 -t walle -c config.yaml
```

也可以持久化：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v12]
  applications: [walle]
```

## 运行时能力

| 项目 | 当前值 |
| --- | --- |
| Application | `walle` |
| 阶段 | `experimental` |
| 协议 | `onebot.v12` |
| 连接方式 | `websocket` |
| 扩展动作 | `get_walle_application_info` |
| 验证级别 | `documented` |
| 上游 | [Walle](https://github.com/onebot-walle/walle) |

运行后可通过 `GET /api/applications` 查看逐账号、逐协议的实际能力。生成脱敏连接模板：

```bash
onebots frameworks --framework walle --account <platform.account_id>
```

## 使用边界

当前只声明 OneBot 12 WebSocket 应用端能力，HTTP/WebHook 与完整动作矩阵未验证。

该状态允许通过 `-t` 激活，但在完成固定版本互操作前不会提升为 `available`。
