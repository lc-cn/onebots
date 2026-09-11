# 诊断与常见故障

先确认你正在操作正确的服务范围和工作区：

```bash
onebots status --json
onebots doctor --data-dir /path/to/data --json --strict
```

系统级原生服务给 `status` 和 `doctor` 追加 `--system`。Docker 只使用 `--data-dir /data`。

## 按故障边界排查

| 现象 | 先检查 | 处理 |
| --- | --- | --- |
| Web 和 TUI 都无法连接 | 管理服务、端口、`--data-dir` | `onebots status`；前台部署检查 `serve` 终端，系统托管查看服务日志 |
| Web 可用，网关未运行 | 网关实际/期望状态、配置校验 | 在 Web/TUI 修复配置，再执行 `onebots control start` |
| 管理进程所有权无法确认 | OS 服务身份、元数据、未完成操作 | 运行 `status --json`，按原操作 ID `recover`；不要强制修改运行态 |
| catalog 可读但 plan/install 不可用 | 安装服务写入门禁、历史操作记录 | 查看控制操作日志和原安装任务；修复记录兼容或权限后再计划 |
| 配置草稿无法应用 | Schema 错误或版本冲突 | 重新读取活动配置，修正字段并再次校验，不强制覆盖 |
| 账号要求扫码、短信或确认 | 登录验证挑战 | 在 Web/TUI 处理当前挑战；保留操作 ID，结果未知时查询回执 |
| 协议连接失败 | 协议监听、路径、token、容器网络 | 对照协议页；跨容器使用可达服务名，不使用另一容器的 `127.0.0.1` |
| Web 本地终端不可用 | 当前 URL、`node-pty`、管理服务日志 | 使用 `localhost`、`127.0.0.1` 或 `[::1]` 直连；运行 `onebots doctor` |
| 终端刚连接就关闭 | 单次票据是否过期或已消费、页面是否切走 | 回到终端页重新连接；不要复用旧票据或在反向代理后重试 |
| 服务操作超时 | 原操作记录 | `onebots recover --operation <ID>` 对账，不重复启停或卸载 |

## 日志分工

系统托管的管理服务日志：

```bash
onebots logs -n 200
onebots logs -f
```

管理接口中的三类日志：

```bash
onebots control logs --data-dir /path/to/data --source manager
onebots control logs --data-dir /path/to/data --source gateway
onebots control logs --data-dir /path/to/data --source operation
```

Web 的“运行与诊断”页面显示同样的管理服务、网关和控制操作分层。日志可能含平台凭据和消息内容，分享前先脱敏。

Windows 尚未提供 `onebots logs` 命令验收，请查看系统事件日志和 Web 日志。Docker 使用 `docker logs <容器名>` 查看容器主进程，再用 Web/控制日志区分管理服务与网关。

## Web 本地终端

本地终端不是远程管理协议。服务端只接受来自 `localhost`、`127.0.0.1` 或 `[::1]` 的本机页面，并由已登录设备会话签发 30 秒有效、只能消费一次的连接票据。每条 WebSocket 连接创建独立 PTY；切走页面或连接断开后，该 PTY 会被终止。

排查顺序：

1. 确认地址栏直接使用本机回环地址，没有经过域名、反向代理或远程主机。
2. 刷新终端页以申请新票据，不复用已消费或超过 30 秒的票据。
3. 确认管理服务使用 Node.js 24；`@karinjs/node-pty` 的引擎范围不支持 Node.js 25 及更高版本。
4. 运行 `onebots doctor --data-dir /path/to/data`，检查原生 PTY 组件是否随当前 OneBots 安装正确加载。
5. 查看 `manager` 日志，确认 WebSocket 建立后是否立即断开。

终端 shell 与管理服务使用同一 OS 用户权限。Node 版本或原生 PTY 组件异常只会禁用 Web 本地终端，不应阻止管理服务和其他控制功能启动。不要通过公网暴露管理端口、SSH 转发或修改来源判断来启用远程终端；需要远程维护时使用主机已有的 SSH、堡垒机或系统运维通道。

## 私有依赖安装失败

ICQQ 等私有模块常见原因：

1. Token 缺少 `read:packages`、组织授权或具体包访问资格。
2. 把 Token 写进业务配置，但安装任务实际没有从安全输入收到授权。
3. 必需 peer 没有和适配器一起进入计划。
4. Alpine、Node ABI 或目标架构与原生依赖不兼容。
5. `/data` 没有完整持久化，候选和操作记录随容器消失。

通过 Web/TUI 安装时按提示输入一次性授权。自动化时：

```bash
printf '%s' "$GITHUB_PACKAGES_TOKEN" | \
  onebots control install --data-dir /path/to/data \
    --plan <计划ID> --request <任务ID> --auth-stdin
```

不要用 `npm install --save` 修改活动运行目录。Monorepo 的 `catalog:` 是 pnpm workspace 协议，用 npm 在源码工作区安装会报 `EUNSUPPORTEDPROTOCOL`，也绕过 OneBots 的候选验证和回退边界。

## `doctor` 结果怎么处理

- `warning`：默认可继续观察；部署门禁中的 `--strict` 会将其视为失败。
- `failed` 或退出码 1：保留 JSON 报告，按具体检查项修复权限、服务身份、运行版本或配置。
- `--fix`：旧自动修复已停用。它不会替你删除记录、覆盖服务定义或重写配置。
- 平台账号仍需真实连通验证：离线诊断通过不证明 Token、网络、权限或回调已可用。

## 安全边界

- 不把设备凭证、协议 token、平台密钥或私有仓库 Token 粘贴到 issue 和完整日志中。
- 不通过清空历史、删除锁或移除操作记录绕过未知结果。
- 不对工作区使用 `chmod 777`；服务用户必须拥有明确的读写权限。
- 不在未备份时删除 `.control`、数据库或账号会话目录。
- 不把 Docker socket 挂给 OneBots，也不把长期 `.npmrc` 挂入容器。

仍无法定位时，收集已脱敏的 `status --json`、`doctor --json --strict`、三类控制日志、系统服务日志和原操作 ID。不要包含设备码、会话令牌或平台凭据。
