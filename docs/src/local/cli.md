# CLI 命令索引

以下命令以当前 `onebots --help` 和命令实现为准。没有显式 `--data-dir` 时，前台与控制命令使用 `ONEBOTS_WORKSPACE`，再回退到当前目录；系统服务命令根据用户级或 `--system` 范围查找已安装服务。

## 管理服务

| 命令 | 用途 | 常用参数 |
| --- | --- | --- |
| `onebots serve` | 前台启动管理服务 | `--data-dir`、`--host`、`--port` |
| `onebots install` | 注册管理服务，不自动启动 | `--data-dir`、`--host`、`--port`、`--system` |
| `onebots start` | 启动已注册的管理服务 | `--system` |
| `onebots stop` | 停止管理服务，保留网关期望状态 | `--system` |
| `onebots restart` | 重启管理服务，保留网关期望状态 | `--system` |
| `onebots status` | 分别显示管理服务和网关状态 | `--system`、`--json` |
| `onebots logs` | 读取系统托管的管理服务日志 | `--system`、`-n <行数>`、`-f` |
| `onebots uninstall` | 移除系统托管，保留工作区全部数据 | `--system` |
| `onebots migrate` | 将旧服务迁移到常驻管理服务 | `--system`；Windows 可用 `--restart` |
| `onebots recover` | 对账原操作，或明确回退迁移/升级 | `--operation <ID>`、`--system` |

`onebots logs` 当前只验收 Linux systemd 和 macOS launchd。Windows 请使用系统事件日志和 Web 的管理服务日志页，不要把不支持的 CLI 输出当作服务故障。

## 工作台与认证

```bash
# 打开完整工作台；tui 是兼容别名
onebots ui --data-dir /path/to/data

# 直接进入安装或配置向导
onebots setup --data-dir /path/to/data
onebots ui --data-dir /path/to/data --configure

# 首次配对、新增设备、丢失凭证后的恢复
onebots auth bootstrap --data-dir /path/to/data
onebots auth device --data-dir /path/to/data
onebots auth recover --data-dir /path/to/data
```

设备码属于本机操作，不接受把设备凭证写在命令参数中。

## 网关控制与日志

```bash
onebots control status  --data-dir /path/to/data
onebots control start   --data-dir /path/to/data
onebots control stop    --data-dir /path/to/data
onebots control restart --data-dir /path/to/data

onebots control logs --data-dir /path/to/data --source manager
onebots control logs --data-dir /path/to/data --source gateway
onebots control logs --data-dir /path/to/data --source operation
```

`onebots control logs` 从管理接口读取最近 64 KiB，来源只能是 `manager`、`gateway` 或 `operation`。它与 `onebots logs -f` 的系统托管日志不是同一入口。

远程控制目前只支持 `status`、`start`、`stop` 和 `restart`，设备凭证必须从标准输入传入：

```bash
printf '%s' "$ONEBOTS_DEVICE_TOKEN" | \
  onebots control status --url https://onebots.example.com --auth-stdin
```

## 扩展安装与移除

交互安装：

```bash
onebots extensions install --data-dir /path/to/data
```

移除前先删掉引用该扩展的账号、协议或 `plugins` 配置并应用：

```bash
onebots extensions remove --data-dir /path/to/data \
  --adapter mock --protocol onebot-v11 --framework zhin
```

自动化安装必须分步保留计划 ID、任务 ID 和候选 ID：

```bash
onebots control plan --data-dir /path/to/data \
  --adapters mock --protocols onebot-v11 --frameworks zhin

onebots control install --data-dir /path/to/data \
  --plan <计划ID> --request <本次唯一任务ID>

onebots control installation --data-dir /path/to/data --request <同一任务ID>
onebots control activate --data-dir /path/to/data --generation <候选ID>
```

私有下载授权只能通过 `--auth-stdin` 传给 `control install`。结果未知时查询同一个任务 ID，不要换 ID 重派。

## 更新与诊断

```bash
# 网关运行版本：只检查；有更新退出 2，无更新退出 0
onebots update --check --data-dir /path/to/data

# 网关运行版本：交互确认安装和激活
onebots update --data-dir /path/to/data

# 管理程序：只检查或交互更新
onebots update --manager --check
onebots update --manager

# 诊断；CI 或部署门禁使用 JSON + strict
onebots doctor --data-dir /path/to/data
onebots doctor --data-dir /path/to/data --json --strict
```

系统级管理程序更新追加 `--system`。Docker 不使用 `update --manager`，应替换镜像并保留数据卷。

## 只读发现命令

```bash
onebots capabilities --json
onebots frameworks --json
onebots frameworks --framework nonebot --account qq.123456 --origin http://127.0.0.1:6727
```

能力目录和框架接入面可在未配置账号时查看。指定账号后，输出才包含该账号和当前连接条件产生的差异。

::: danger 已移除的启动方式
不要再用 `-r/--register`、`-p/--protocol`、`-t/--target` 或 `-c/--config` 直接拼装网关。扩展必须经过计划、安装、验证和激活；配置必须经过草稿、校验和应用。
:::
