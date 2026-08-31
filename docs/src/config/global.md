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
timeout: 30             # 登录超时时间(秒)

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
- **说明**: 账号登录超时时间

## 配置优先级

```
账号协议配置 > general 默认配置
```

## 启动前校验

OneBots 在连接平台或启动协议传输之前，会使用当前通过 `-r` / `-p` 加载的插件 Schema 校验完整配置。校验范围包括平台必填凭据、字段类型与取值、账号引用的适配器和协议、每个账号至少具备一个已加载协议出口，以及账号协议配置与 `general` 默认值合并后的结果。

错误消息会包含完整路径，例如 `qq.my_bot.appid`、`qq.my_bot.onebot.v11.use_http` 或 `qq.my_bot: 账号至少需要配置一个已加载的协议出口`。配置了未加载的适配器或协议也会直接阻止启动，避免账号被静默忽略。Web 管理端、setup、doctor 和热重载使用同一验证器，无效内容不会写入配置文件。

Web 管理端的“保存并应用”会先原子保存，再热重载账号与协议。运行态应用失败时，磁盘配置和运行态都会恢复上一版本；端口、路径、数据库等宿主参数会保留到文件，并明确列出需要重启后生效的字段。另一项保存或重载进行中时返回 HTTP 409，不会覆盖正在应用的配置。

仍使用根管理 WebSocket 的集成可以发送 `{ "action": "system.saveConfig", "data": "...", "echo": "request-id" }` 或 `system.reload`。两者使用同一事务与并发锁，并返回 `{ "event": "system.config.result", "echo": "request-id", "data": ... }`；失败回执的 `code` 为 `CONFIG_INVALID`、`CONFIG_CONFLICT` 或 `CONFIG_APPLY_FAILED`。`system.reload` 只重新读取磁盘配置，不重写文件或创建备份。

部署前可使用与服务相同的插件参数执行：

```bash
onebots doctor -c config.yaml -r qq -p onebot-v11 --json
```

如果已经通过 `onebots install` 安装服务，doctor 会读取服务定义中保存的插件列表，无需重复传入。
