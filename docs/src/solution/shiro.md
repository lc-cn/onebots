# Shiro

Shiro 已进入可激活的 OneBots Application 运行时，状态为 `experimental`。它会为匹配的 `onebot.v11` 协议实例公开连接能力、限制和 `get_shiro_application_info` 兼容动作。

## 启动

```bash
onebots -r <adapter> -p onebot-v11 -t shiro -c config.yaml
```

也可以持久化：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [shiro]
```

## 运行时能力

| 项目 | 当前值 |
| --- | --- |
| Application | `shiro` |
| 阶段 | `experimental` |
| 协议 | `onebot.v11` |
| 连接方式 | `websocket` |
| 扩展动作 | `get_shiro_application_info` |
| 验证级别 | `documented` |
| 上游 | [Shiro](https://github.com/MisakaTAT/Shiro) |

运行后可通过 `GET /api/applications` 查看逐账号、逐协议的实际能力。生成脱敏连接模板：

```bash
onebots frameworks --framework shiro --account <platform.account_id>
```

## 使用边界

尚未固定 Spring Boot starter 版本，当前门禁只覆盖协议身份、连接描述和兼容动作。

该状态允许通过 `-t` 激活，但在完成固定版本互操作前不会提升为 `available`。
