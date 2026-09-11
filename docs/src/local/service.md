# 系统服务

系统服务只维护常驻管理进程。平台账号和协议出口由管理服务中的网关生命周期控制。

## 平台与范围

| 平台 | 用户级服务 | 系统级服务 | 日志入口 |
| --- | --- | --- | --- |
| Linux | systemd user | systemd system | `onebots logs`；系统级追加 `--system` |
| macOS | LaunchAgent | LaunchDaemon | `onebots logs`；系统级追加 `--system` |
| Windows | 不支持 | Windows SCM，必须管理员终端 | 系统事件日志与 Web 日志 |
| Docker | 不适用 | 不适用 | `docker logs` 与 Web 日志 |

普通单用户机器优先使用用户级服务。共享服务器、无登录会话运行或 Windows 使用系统级服务。Linux/macOS 的系统级命令需要管理员权限。

## 首次安装

用户级：

```bash
onebots install --data-dir "$HOME/onebots-data"
onebots start
onebots status
```

Linux/macOS 系统级：

```bash
sudo onebots install --system --data-dir /var/lib/onebots
sudo onebots start --system
sudo onebots status --system
```

Windows 在管理员 PowerShell 中运行 `install.ps1` 完成空目录引导。后续命令固定使用系统级范围：

```powershell
onebots start --system
onebots status --system --json
```

`install` 注册服务但不启动，不读取业务配置，也不会预填适配器、协议、框架或账号。安装成功后再执行 `start`。

## 日常操作

```bash
onebots status --json
onebots restart
onebots logs -n 200
onebots logs -f
```

系统级服务为每条命令追加 `--system`。`status` 会分别显示 OS 管理服务状态、网关实际状态和期望状态。重启管理服务会保留网关期望状态；管理服务恢复后按已记录意图管理网关。

只重启网关时使用：

```bash
onebots control restart --data-dir /path/to/data
```

## 卸载系统托管

先确认服务范围和状态，再卸载：

```bash
onebots status
onebots uninstall
```

系统级服务追加 `--system`。卸载只移除服务定义和托管状态，保留工作区、认证、配置、账号数据、日志和操作记录。确认不再需要数据后，才在独立维护步骤处理工作区；`uninstall` 不替你删除它。

## 迁移旧服务

检测到“旧服务须先执行 migrate”时，不要覆盖安装：

```bash
onebots migrate
```

系统级旧服务追加 `--system`。迁移保留原工作区和启停意图，并创建可恢复记录。Windows 如迁移准备明确要求完整系统重启，才使用 `--restart`；不要把它作为常规选项。

迁移或服务操作返回未知结果时，记录输出中的操作 ID：

```bash
onebots recover --operation <原操作ID>
```

`recover` 默认只核验目标是否已达到，不重放启停、安装或删除。明确回退迁移时使用 `--rollback-migration`，且只能对原操作执行。

## 不要这样操作

- 不要同时安装用户级和系统级服务指向同一工作区。
- 不要用 `systemctl`、`launchctl` 或 `sc.exe` 手工覆盖 OneBots 生成的定义文件。
- 不要在服务结果未知时重复执行相同启停、安装或卸载命令。
- 不要用删除元数据或操作记录的方式解除安全门禁。
- 不要在 Docker 容器内安装操作系统服务。
