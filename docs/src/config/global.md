# 全局配置

onebots 使用 YAML 格式的配置文件，默认读取运行目录下的 `config.yaml`。

## 配置说明

配置文件包含以下内容：

- **服务配置**：HTTP 端口、日志级别、超时时间等
- **协议默认值**：各协议的通用配置（general 部分）
- **账号配置**：各平台机器人的认证信息和个性化设置

## 配置文件结构

```yaml
# 全局配置
port: 6727              # HTTP 服务器端口
log_level: info         # 日志级别
timeout: 30             # 账号与协议出口启动超时(秒)
access_token: "replace-with-a-long-random-token" # 管理端鉴权码（敏感）

# 未传入 -r / -p 时加载的插件
plugins:
  adapters: [qq]
  protocols: [onebot-v11]

# 通用配置（协议默认配置）
general:
  {protocol}.{version}:
    # 协议配置项...

# 账号配置
{platform}.{account_id}:
  # 协议配置（可配置多个）
  {protocol}.{version}:
    # 协议配置项（覆盖 general）
  
  # 平台配置
  # 平台特定的配置项...
```

## 全局配置项

### port

- **类型**: `number`
- **默认值**: `6727`
- **说明**: HTTP 服务器监听端口

### log_level

- **类型**: `string`
- **可选值**: `trace` | `debug` | `info` | `warn` | `error`
- **默认值**: `info`
- **说明**: 日志输出级别

### timeout

- **类型**: `number`
- **默认值**: `30`
- **单位**: 秒
- **说明**: 等待账号登录监听器与协议出口完成启动的全局保护窗口。超时会中止传给扩展的 `AbortSignal`、将正在启动的协议标记为失败，并继续尝试其他账号。需要扫码等合法长登录流程的适配器可以抬高单个账号的窗口，但不能缩短该全局值；例如微信 ClawBot 默认使用 480 秒。适配器与协议应监听该信号，及时取消仍在进行的网络连接或登录流程。

管理 API 返回的账号摘要和 Web 管理端机器人卡片会显示最终生效的 `startupTimeoutSeconds`，便于在启动前确认实际保护边界。

### database

- **类型**: 非空 `string`
- **默认值**: `onebots.db`
- **说明**: SQLite 数据库文件。相对路径以配置文件同级的 `data` 目录为根，绝对路径保持不变；未以 `.db` 结尾时会自动补充扩展名，修改后需要重启。`onebots doctor` 会验证解析后的实际文件及其父目录是否可读写，而不只检查默认数据目录。

### access_token / username / password

- **类型**: `string`
- **说明**: Web 管理端与 `/api`、根管理 WebSocket 的认证材料。推荐使用高熵 `access_token`；也可以配置完整的 `username` 与 `password`。
- **部署覆盖**: `ONEBOTS_ACCESS_TOKEN` 环境变量优先于配置文件中的 `access_token`，适合无法直接读取配置文件的容器与托管平台。环境变量生效时不会生成新的配置鉴权码，也不会把环境值写入文件或日志；轮换后需要重启进程。
- **首次启动**: 没有环境变量且三项均未形成有效凭据时，setup 或运行时会生成 256 位随机 `access_token` 并写入权限受限的配置文件，鉴权码不会输出到服务日志。

## 配置优先级

```
账号协议配置 > general 默认配置
ONEBOTS_ACCESS_TOKEN > config.yaml 的 access_token
每类显式 -r / -p 参数 > plugins 中对应类别的默认值
```

`plugins.adapters` 与 `plugins.protocols` 是 setup 持久化的运行时插件默认值。两项都是插件短名数组；缺少 `plugins` 的旧配置仍然有效。显式传入某一类参数时，只覆盖该类别，例如 `-r qq` 会覆盖 `plugins.adapters`，但仍复用 `plugins.protocols`。

Web 管理端会把当前进程已完成入口加载和注册契约校验的插件显示为可添加建议，并同时保留自定义输入，用于第三方插件短名或完整包名。建议清单只代表当前运行时证据，不会被当作封闭白名单；自定义值仍会在下次启动或 doctor 中经过正常的包解析与注册校验。

Web 管理端可以保存插件选择，但运行中的进程无法安全地卸载或替换插件，因此该变更会明确提示需要重启。已通过 `onebots install` 安装的服务以服务定义中保存的插件列表为准；修改 `plugins` 后应重新执行 `onebots install -c config.yaml` 更新服务定义，再启动或重启服务。

## 启动前校验

OneBots 在连接平台或启动协议传输之前，会使用当前通过 `-r` / `-p` 加载的插件 Schema 校验完整配置。校验范围包括平台必填凭据、字段类型与取值、账号引用的适配器和协议、每个账号至少具备一个已加载协议出口，以及账号协议配置与 `general` 默认值合并后的结果。

错误消息会包含完整路径，例如 `qq.my_bot.appid`、`qq.my_bot.onebot.v11.use_http` 或 `qq.my_bot: 账号至少需要配置一个已加载的协议出口`。配置了未加载的适配器或协议也会直接阻止启动，避免账号被静默忽略。Web 管理端、setup、doctor 和热重载使用同一验证器，无效内容不会写入配置文件。

Web 管理端的“保存并应用”会先原子保存，再热重载账号与协议。运行态应用失败时，磁盘配置和运行态都会恢复上一版本；端口、路径、数据库等宿主参数会保留到文件，并明确列出需要重启后生效的字段。另一项保存或重载进行中时返回 HTTP 409，不会覆盖正在应用的配置。

仍使用根管理 WebSocket 的集成必须在握手时通过 `Authorization: Bearer <token>` 或 `?access_token=<token>` 鉴权，未授权请求会在升级前返回 HTTP 401。连接后可以发送 `{ "action": "system.saveConfig", "data": "...", "echo": "request-id" }` 或 `system.reload`。两者使用同一事务与并发锁，并返回 `{ "event": "system.config.result", "echo": "request-id", "data": ... }`；失败回执的 `code` 为 `CONFIG_INVALID`、`CONFIG_CONFLICT` 或 `CONFIG_APPLY_FAILED`。`system.reload` 只重新读取磁盘配置，不重写文件或创建备份。

部署前可使用与服务相同的插件参数执行：

```bash
onebots doctor -c config.yaml --json --strict
```

默认模式允许首次配置流程继续，并把未配置账号、服务未安装或已停止、无法完成合法管理凭据探测等状态保留为警告。生产部署使用 `--strict` 时，任一警告都会令 JSON 中的 `ok` 为 `false` 并返回退出码 `1`。配置未包含 `plugins` 时仍可传入 `-r` / `-p`。未指定 `-c`，或显式路径就是已安装服务使用的配置时，doctor 会优先读取服务定义中保存的插件列表。显式传入另一份 `-c` 时则执行独立诊断：使用该文件的 `plugins`，不读取、判旧或通过 `--fix` 修改另一份服务定义。输出中的 `plugin-selection` 会逐类别列出最终插件、来源与解析目录，JSON 模式保留同一证据。
