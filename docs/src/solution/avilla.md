# Avilla

Avilla 已进入可激活的 OneBots Application 运行时，状态为 `experimental`。它会为匹配的 `satori.v1` 协议实例公开连接能力、限制和 `get_avilla_application_info` 兼容动作。

## 启动

```bash
onebots -r <adapter> -p satori-v1 -t avilla -c config.yaml
```

也可以持久化：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [satori-v1]
  applications: [avilla]
```

## 运行时能力

| 项目 | 当前值 |
| --- | --- |
| Application | `avilla` |
| 阶段 | `experimental` |
| 协议 | `satori.v1` |
| 连接方式 | `websocket` |
| 扩展动作 | `get_avilla_application_info` |
| 验证级别 | `documented` |
| 上游 | [Avilla](https://github.com/GraiaProject/Avilla) |

运行后可通过 `GET /api/applications` 查看逐账号、逐协议的实际能力。生成脱敏连接模板：

```bash
onebots frameworks --framework avilla --account <platform.account_id>
```

## 使用边界

上游仍将 Satori 组件标记为 WIP，模板只用于实验验证。

该状态允许通过 `-t` 激活，但在完成固定版本互操作前不会提升为 `available`。
