# onebots

OneBots 是多平台、多协议的机器人网关主程序。当前产品由常驻管理服务、独立网关进程、系统托管以及统一的 CLI、TUI、Web 控制端组成。

## 安装

Node.js 需要 24 或更高版本。

```bash
npm install --global onebots
```

首次安装系统托管时指定一个持久工作区：

```bash
# 默认安装用户级服务
onebots install --data-dir /path/to/onebots-data
onebots start

# Linux 系统级服务
sudo onebots install --system --data-dir /var/lib/onebots
sudo onebots start --system
```

`install` 只安装管理服务及其不可变运行候选，不预填平台账号、协议或框架，也不启动进程。`start` 启动受系统托管的管理服务。Docker 部署直接以前台 `onebots serve` 作为容器主进程，不在容器内安装系统服务。

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

前台运行管理服务：

```bash
onebots serve --data-dir /path/to/onebots-data --host 127.0.0.1 --port 6727
# onebots run 是同一入口的别名
```

公开前台入口不接受旧 `-c/-r/-p/-t` 运行参数。旧安装先执行 `onebots migrate`，不要直接覆盖既有系统服务定义。

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
onebots install [--system] [--data-dir PATH] [--host HOST] [--port PORT]
onebots uninstall [--system]
onebots start|stop|restart [--system]
onebots status [--system] [--json]
onebots logs [--system]
onebots migrate [--system]
onebots recover --operation ID [--system]

onebots serve|run [--data-dir PATH] [--host HOST] [--port PORT]
onebots ui [--data-dir PATH]
onebots setup [--data-dir PATH]
onebots auth bootstrap|device|recover [--data-dir PATH]
onebots control status|start|stop|restart [--data-dir PATH]
onebots doctor [--data-dir PATH] [--json] [--strict]
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
