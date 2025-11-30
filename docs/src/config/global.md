# 全局配置

OneBots 使用 YAML 格式的配置文件，默认读取运行目录下的 `config.yaml`。

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
