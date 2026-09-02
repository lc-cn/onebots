# 炸毛框架

炸毛框架 已进入可激活的 OneBots Application 运行时，状态为 `experimental`。它会为匹配的 `onebot.v11` 协议实例公开连接能力、限制和 `get_zhamao_application_info` 兼容动作。

## 启动

```bash
onebots -r <adapter> -p onebot-v11 -t zhamao -c config.yaml
```

也可以持久化：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [zhamao]
```

## 运行时能力

| 项目 | 当前值 |
| --- | --- |
| Application | `zhamao` |
| 阶段 | `experimental` |
| 协议 | `onebot.v11` |
| 连接方式 | `websocket` |
| 扩展动作 | `get_zhamao_application_info` |
| 验证级别 | `documented` |
| 上游 | [炸毛框架](https://github.com/zhamao-robot/zhamao-framework) |

运行后可通过 `GET /api/applications` 查看逐账号、逐协议的实际能力。生成脱敏连接模板：

```bash
onebots frameworks --framework zhamao --account <platform.account_id>
```

## 使用边界

PHP 运行时和 OneBot 驱动版本差异较大，部署前必须按上游版本核对字段。

该状态允许通过 `-t` 激活，但在完成固定版本互操作前不会提升为 `available`。
