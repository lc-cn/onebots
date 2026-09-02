# PepperBot

PepperBot 已进入可激活的 OneBots Application 运行时，状态为 `legacy`。它会为匹配的 `onebot.v11` 协议实例公开连接能力、限制和 `get_pepperbot_application_info` 兼容动作。

## 启动

```bash
onebots -r <adapter> -p onebot-v11 -t pepperbot -c config.yaml
```

也可以持久化：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [pepperbot]
```

## 运行时能力

| 项目 | 当前值 |
| --- | --- |
| Application | `pepperbot` |
| 阶段 | `legacy` |
| 协议 | `onebot.v11` |
| 连接方式 | `websocket` |
| 扩展动作 | `get_pepperbot_application_info` |
| 验证级别 | `documented` |
| 上游 | [PepperBot](https://github.com/SSmJaE/PepperBot) |

运行后可通过 `GET /api/applications` 查看逐账号、逐协议的实际能力。生成脱敏连接模板：

```bash
onebots frameworks --framework pepperbot --account <platform.account_id>
```

## 使用边界

仅面向已有 PepperBot 项目迁移；新项目应选择仍持续验证的现代框架。

该状态允许通过 `-t` 激活，但不会被表述为新部署推荐项。
