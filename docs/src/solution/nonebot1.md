# NoneBot 1

## API 兼容边界

- 协议：`onebot.v11`
- 连接：`reverse-websocket`（OneBots 主动连接框架的 WebSocket 服务）
- Application 不会伪造框架私有动作。标准协议动作由协议层处理，平台私有动作只有在所选 Adapter 的能力清单中存在时才会转发。
- `-t nonebot1` 只加载兼容扩展；它不会开启协议传输，也不会修改账号配置。

## 生成两端配置

先用真实账号键生成方案。输出会同时给出 OneBots YAML、NoneBot 1 端配置、端点和验证步骤：

```bash
onebots frameworks --framework nonebot1 --account <platform.account_id>
```

如果两端不在同一台机器，补充公开地址；反向 WebSocket 方案还要给框架监听地址：

```bash
onebots frameworks --framework nonebot1 --account <platform.account_id> \
  --origin http://<onebots-host>:6727 \
  --framework_origin http://<framework-host>:<port>
```

## 配置 OneBots

安装或加载平台 Adapter、`onebot-v11` 协议和 `nonebot1` Application：

```yaml
plugins:
  adapters: [<adapter>]
  protocols: [onebot-v11]
  applications: [nonebot1]

<platform>.<account_id>:
  account_id: <account_id>
  # 在这里填写对应平台 Adapter 的登录凭据
  onebot.v11:
    use_http: false
    use_ws: false
    use_ws_reverse: true
    ws_reverse_url: <framework-websocket-url>
    access_token: <shared-token>
```

也可在本次启动时显式注册：

```bash
onebots -r <adapter> -p onebot-v11 -t nonebot1 -c config.yaml
```

账号字段按对应[平台文档](/platform/)填写。上面的传输开关必须由用户配置；Application 不会补开。

## 配置 NoneBot 1

把生成结果中的“NoneBot 1 配置”复制到框架项目，并保持三项一致：

1. 协议必须是 `onebot.v11`。
2. 地址必须使用生成结果中的 `endpoint`；容器内不要把另一容器写成 `127.0.0.1`。
3. 两端 token 必须完全相同。未使用 token 时，两端都不要填写。

启动顺序：先启动负责监听的一端，再启动连接方。修改 OneBots YAML 后重启或在 Web 管理端执行“保存并应用”。

## 验证

```bash
onebots doctor -c config.yaml
onebots frameworks --framework nonebot1 --account <platform.account_id>
```

先确认账号在线，再调用生成方案列出的身份动作；收到事件后再测试发送动作。不能仅凭端口可连接就判定兼容完成。

## 排查与修复

| 现象 | 检查 | 修复 |
| --- | --- | --- |
| Application 或协议加载失败 | 查看启动日志中的包名 | 安装对应 npm 包，或用上面的 `-r/-p/-t` 名称重新启动 |
| 连接被拒绝 / 404 | 对照生成的 endpoint 与账号键 | 修正 host、端口、协议路径；正向连接确认 `use_ws: true` |
| 反向连接没有建立 | 检查框架是否先监听及 `ws_reverse_url` | 先启动框架，并把容器地址改为可达服务名 |
| 401 / 鉴权失败 | 比较两端 token | 统一 token，清除旧环境变量后重启两端 |
| `Unknown action` | 查 Application 的 `requiredActions`、`unsupportedActions` 和 Adapter 能力 | 换支持该动作的平台 Adapter、关闭依赖该私有动作的插件，或实现真实的 Application 动作转换 |
| 已连接但没有事件 | 检查账号在线、平台订阅/权限和事件过滤 | 修复平台凭据与回调权限，暂时关闭过滤后重新收包 |

继续按症状执行[框架连接排查手册](/solution/troubleshooting)。
