# 框架连接排查手册

按下面顺序检查，前一步失败时先修复。

## 1. 插件和配置

```bash
onebots doctor -c config.yaml
onebots frameworks --framework <framework> --account <platform.account_id>
```

确认 Adapter、Protocol、Application 都已加载，账号键严格为 `platform.account_id`，协议名称与生成方案一致。“module not found” 应通过安装对应包或修正 `-r/-p/-t` 名称解决。

## 2. 监听和网络

- 正向 WebSocket：OneBots 必须显式设置 `use_ws: true`。
- 反向 WebSocket：框架先监听，OneBots 再连接 `ws_reverse_url`。
- Docker/Compose：另一容器不能使用 `127.0.0.1`，改用服务名。
- 反向代理：确认 WebSocket Upgrade 和账号/协议路径没有被删改。

```bash
curl -i -X POST \
  -H 'Authorization: Bearer <shared-token>' \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:6727/<platform>/<account_id>/onebot/v11/get_login_info
```

`404` 通常是路径错误；`401` 是 token 不一致；返回 `failed` 则继续检查动作和 Adapter。

## 3. API 动作

查看 Application 的 `requiredActions`、`unsupportedActions` 和 Adapter 能力。出现 `Unknown action` 时，应换用真正支持该动作的 Adapter、关闭依赖它的插件，或在 Application 中实现可验证的参数/结果转换并把动作列入 `actions`。不要伪造成功结果。

## 4. 事件

连接成功但没有事件时依次检查账号在线状态、平台事件订阅/回调权限、OneBots 过滤器、框架端过滤器。先关闭过滤并测试简单私聊文本，再恢复群聊和富媒体。

报告问题时附上版本、脱敏配置、doctor 结论、endpoint、连接方向、状态码、失败 action 和错误日志；不要提交 token 或平台密钥。
