# 全局配置

OneBots 管理服务把业务配置保存在指定工作区。Web、TUI 和配置命令共用同一份草稿、校验与应用流程；不要绕过管理服务直接驱动网关进程。

## 工作区

所有管理命令都应指向同一个持久目录：

```bash
onebots serve --data-dir /path/to/onebots-data
onebots auth bootstrap --data-dir /path/to/onebots-data
onebots ui --data-dir /path/to/onebots-data
```

系统服务安装时也要保存这个路径：

```bash
onebots install --data-dir /path/to/onebots-data
onebots start
```

## 配置结构

空白安装不会预填平台账号、协议或框架扩展：

```yaml
port: 6727
log_level: info
timeout: 30
database: onebots.db

plugins:
  adapters: []
  protocols: []
  applications: []

general: {}
```

通过 Web 或 TUI 创建安装计划，安装、验证并激活扩展后，再添加账号配置：

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

账号使用 `{platform}.{account_id}` 作为键。账号下的协议配置覆盖 `general` 中相同协议的默认值。

## 全局字段

| 字段 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `port` | `number` | `6727` | 网关协议传输监听端口 |
| `log_level` | `string` | `info` | `trace`、`debug`、`info`、`warn` 或 `error` |
| `timeout` | `number` | `30` | 账号与协议出口启动保护窗口，单位为秒 |
| `database` | 非空 `string` | `onebots.db` | SQLite 文件；相对路径按工作区解析 |
| `plugins.adapters` | `string[]` | `[]` | 活动运行版本中的平台适配器 |
| `plugins.protocols` | `string[]` | `[]` | 活动运行版本中的输出协议 |
| `plugins.applications` | `string[]` | `[]` | 活动运行版本中的框架扩展 |

`timeout` 到期时，OneBots 会中止传给扩展的 `AbortSignal`，把仍在启动的出口标记为失败，并继续处理其他账号。需要扫码等长登录流程的适配器可以声明更长窗口。

`database` 修改后需要重启。`onebots doctor` 会检查解析后的文件和 SQLite 写入日志所需的父目录权限。

## 管理认证与协议认证

管理端只使用一次性设备码配对和可撤销的设备会话：

```bash
onebots auth bootstrap --data-dir /path/to/onebots-data
onebots auth device --data-dir /path/to/onebots-data
onebots auth recover --data-dir /path/to/onebots-data
```

根级 `username`、`password` 或 `access_token` 不再是管理端登录配置。迁移旧配置时，管理服务不会把这些字段带入网关配置快照。

协议内部的 `access_token`、`token` 和签名密钥属于业务连接配置，必须保留。例如 `general.onebot.v11.access_token` 只保护 OneBot v11 API 与传输，不可用于登录 Web 管理端。

## 安装与应用边界

`plugins` 记录活动运行版本的扩展选择。安装计划必须先解析主包和 peer 依赖，验证候选工件，再由操作者显式激活。安装扩展不会自动连接平台或启用协议。

使用 `onebots extensions install --data-dir <工作区>` 进入完整依赖选择向导。移除扩展前，先在配置草稿中删除对应账号和协议出口、取消 `plugins` 启用选择并应用配置；然后运行 `onebots extensions remove --adapter <名称>`、`--protocol <名称>` 或 `--framework <名称>`。移除同样创建新的完整运行版本，当前活动目录不会被原地修改；只有候选安装、验证并再次确认激活后，依赖才从活动版本中消失。`--plan-only` 只输出计划，不安装或激活。

Web 与 TUI 使用同一事务应用配置。无效草稿不能替换活动配置；配置运行态应用失败时，文件和运行态都恢复到上一版本。端口、数据库等宿主字段会明确提示需要重启后生效。

完整配置在连接平台前按活动扩展注册的 Schema 校验，包括平台必填凭据、字段类型、适配器和协议引用、账号协议出口，以及账号与 `general` 合并后的结果。错误会返回完整路径，例如 `qq.my_bot.appid`。

## 部署前检查

```bash
onebots doctor --data-dir /path/to/onebots-data --json --strict
```

默认模式把首次配置中可恢复的状态记录为警告。`--strict` 会令任一警告返回失败退出码，适合作为部署门禁。旧安装应先执行 `onebots migrate`，不要继续使用旧运行参数临时覆盖活动版本。

## 相关文档

- [协议配置](/config/protocol)
- [平台配置](/config/platform)
- [生产部署](/guide/production)
