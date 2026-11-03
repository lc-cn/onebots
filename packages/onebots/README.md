# onebots

OneBots 是多平台、多协议的机器人网关主程序。当前产品由常驻管理服务、独立网关进程、系统托管以及统一的 CLI、TUI、Web 控制端组成。

## 安装

Node.js 需要 24 或更高版本。

```bash
npm install --global onebots
```

Linux/macOS 首次安装用户级服务时，指定全新工作区和独立的卷外 authority；计划文件留在工作区之外：

```bash
umask 077
onebots install --data-dir "$HOME/onebots-data" --authority-dir "$HOME/onebots-authority"
# install 保持服务停止。阅读计划，确认会话失效影响后用实际 digest 登记。
onebots workspace plan --data-dir "$HOME/onebots-data" \
  --authority-dir "$HOME/onebots-authority" > "$HOME/onebots-plan.json"
onebots workspace register --plan-file "$HOME/onebots-plan.json" --confirm '<plan.digest>'
onebots start
```

`install` 只安装管理服务及其不可变运行候选并保持停止；`register` 不启动管理服务或网关。登记成功后才能 `start`，管理服务运行后再签发配对码。后文的 `/path/to/onebots-data` 与 `/path/to/onebots-authority` 均须换成实际路径；两者互不包含且持久保存，authority 的父目录由部署准备。

系统级服务追加 `--system` 并使用相应管理员权限。Windows 请使用[管理员安装脚本](https://onebots.pages.dev/guide/start)，由安装器准备私有 ACL 并打印登记步骤，不套用 POSIX 目录命令。脚本会验证公开包的来源登记能力，源码位于 `docs/src/public`，不会自动确认登记。

Docker 直接运行前台管理服务，不在容器内安装系统服务；必须持久挂载整个 `/data` 和独立 authority 卷，离线登记时复用两个卷并从宿主 stdin 传入计划，详见[Docker 部署](https://onebots.pages.dev/guide/docker)。本机制不提供 authority/整机克隆的全局互斥或跨机 HA；HF 模板首期禁用 `HF_REPO_ID` 自动恢复。

## 首次登录

管理端只使用设备码配对和可撤销的浏览器会话。管理服务启动后，在同一台机器执行：

```bash
onebots auth bootstrap --data-dir /path/to/onebots-data
```

打开管理地址，默认是 `http://127.0.0.1:6727`，在五分钟内输入一次性设备码。管理登录不读取业务 `config.yaml` 中的用户名、密码或根级 `access_token`。

添加另一台浏览器设备：

```bash
onebots auth device --data-dir /path/to/onebots-data
```

丢失全部浏览器凭据时，从管理服务所在机器签发恢复码：

```bash
onebots auth recover --data-dir /path/to/onebots-data
```

平台密钥和 OneBot、Milky、MCP 等协议出口的 `access_token` 属于业务配置，仍应按对应插件文档填写；它们不用于登录管理端。

## 安装扩展与配置

启动 TUI：

```bash
onebots ui --data-dir /path/to/onebots-data
```

也可以打开 Web 控制台。两个入口共用管理服务的安装计划、配置草稿、校验、应用和操作记录：

1. 选择平台适配器、输出协议和框架兼容扩展。
2. 检查主包、必需 peer 和下载授权需求。
3. 安装并验证候选运行版本。
4. 显式激活候选版本。
5. 填写平台账号及协议连接配置，校验后应用。

安装、激活、配置和启动是不同操作。安装扩展不会自动连接平台，也不会强制启用任何协议。

## 进程控制

系统托管命令管理常驻管理服务：

```bash
onebots start
onebots stop
onebots restart
onebots status --json
onebots logs
onebots uninstall
```

网关生命周期由运行中的管理服务控制：

```bash
onebots control status --data-dir /path/to/onebots-data
onebots control start --data-dir /path/to/onebots-data
onebots control stop --data-dir /path/to/onebots-data
onebots control restart --data-dir /path/to/onebots-data
```

停止网关不会关闭管理服务或 Web。管理服务重启后会保留网关的期望状态。

将同一已登记实例改为前台运行时，先正常停止系统服务，再沿用原 authority：

```bash
onebots serve --data-dir /path/to/onebots-data \
  --authority-dir /path/to/onebots-authority --host 127.0.0.1 --port 6727
# onebots run 是同一入口的别名
```

已登记前台实例改托管也须先正常关闭前台，再用相同数据和 authority 路径 `install`、`start`，不重复登记。新空目录的前台登记示例见[快速开始](https://onebots.pages.dev/guide/start)。公开前台入口不接受旧 `-c/-r/-p/-t` 参数。旧 control v1 服务按[离线升级流程](https://onebots.pages.dev/guide/workspace-admission)处理；更早的单进程 legacy 不能直接执行严格版 `onebots migrate`，不要覆盖旧服务定义。

## 配置模型

业务配置由管理服务保存在工作区，通过 Web、TUI 或配置命令编辑。空白配置不会生成账号或协议：

```yaml
plugins:
  adapters: []
  protocols: []
  applications: []

general: {}
```

账号使用 `{platform}.{account_id}` 作为键，协议配置可以放在 `general` 中作为默认值，也可以在账号下覆盖：

```yaml
plugins:
  adapters: [qq]
  protocols: [onebot-v11]
  applications: []

general:
  onebot.v11:
    use_http: true
    access_token: replace-with-a-protocol-token

qq.my_bot:
  appid: replace-with-app-id
  secret: replace-with-app-secret
  onebot.v11:
    use_ws: true
```

这里的 `onebot.v11.access_token` 只保护 OneBot 协议连接，不是管理端凭据。

## 常用命令

```text
onebots install [--system] [--data-dir PATH] [--authority-dir PATH] [--host HOST] [--port PORT]
onebots uninstall [--system]
onebots start|stop|restart [--system]
onebots status [--system] [--json]
onebots logs [--system]
onebots recover --operation ID [--system]

onebots workspace plan|inspect --data-dir PATH [--authority-dir PATH]
onebots workspace register --plan-file FILE|- --confirm DIGEST
onebots workspace resume --request ID --data-dir PATH [--authority-dir PATH]
onebots serve|run [--data-dir PATH] [--authority-dir PATH] [--host HOST] [--port PORT]
onebots ui [--data-dir PATH]
onebots setup [--data-dir PATH]
onebots auth bootstrap|device|recover [--data-dir PATH]
onebots control status|start|stop|restart [--data-dir PATH]
onebots doctor [--data-dir PATH] [--authority-dir PATH] [--json] [--strict]
onebots update [--check] [--data-dir PATH]
onebots send [--data-dir PATH] ...
onebots mcp [--data-dir PATH] [--account 平台/账号]
```

## 开发

```bash
pnpm install
pnpm build:packages
pnpm build
pnpm test
```

适配器、协议和框架扩展通过各自的注册表与声明式 Schema 接入运行版本。应用开发不应自行构造旧管理宿主；使用 OneBots 管理服务完成安装和生命周期控制，通过公开协议或 `@onebots/core/control` 客户端与产品交互。

## 相关链接

- [OneBots 文档](../../docs)
- [GitHub 仓库](https://github.com/lc-cn/onebots)
- [MIT License](../../LICENSE)
