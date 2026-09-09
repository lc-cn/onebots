# 在 Node.js 项目中使用 OneBots

OneBots 作为独立的管理服务和网关进程运行。业务项目不需要构造 `App` 或
`createOnebots()`，而是通过公开协议连接 OneBots。

## 安装并启动管理服务

Node.js 需要 24 或更高版本。

```bash
npm install --global onebots
onebots serve --data-dir ./onebots-data
```

首次使用时，在管理服务所在机器签发一次性设备码：

```bash
onebots auth bootstrap --data-dir ./onebots-data
```

打开 `http://127.0.0.1:6727`，输入设备码完成浏览器配对。后续管理操作使用可撤销的设备会话。

## 安装扩展并配置账号

在 Web 控制台或 TUI 中创建安装计划，选择平台适配器、输出协议和框架扩展。确认计划后，管理服务会安装并校验完整依赖，再由你显式激活候选版本。

```bash
onebots ui --data-dir ./onebots-data
```

激活扩展后，填写平台账号和协议连接配置，校验并应用配置，再启动网关。停止网关不会关闭管理服务。

```bash
onebots control start --data-dir ./onebots-data
onebots control status --data-dir ./onebots-data
```

OneBot、Milky、MCP 等协议的 `access_token` 只保护协议连接，不是管理端登录凭据。

## 从业务代码连接

业务项目按所选协议使用 HTTP、WebSocket、Webhook、反向 WebSocket、SSE 或对应 SDK 连接网关。例如，OneBot v11 HTTP API 的地址形式为：

```text
POST http://127.0.0.1:6727/{platform}/{account_id}/onebot/v11/{action}
```

进程安装、升级、配置和生命周期操作由 OneBots 管理服务负责。需要从本机自动化这些操作时，使用 `@onebots/core/control` 提供的控制客户端，不要在业务进程内嵌旧管理宿主。
