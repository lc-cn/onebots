# onebots

多平台多协议的机器人应用启动器 - onebots 主应用包

## 简介

`onebots` 是 onebots 框架的主应用包，提供了完整的应用层功能，包括配置管理、适配器加载、协议注册等。它基于 `@onebots/core` 核心库，为开发者提供开箱即用的机器人应用解决方案。

## 特性

- 🚀 **即开即用** - 内置命令行工具，快速启动
- 🔧 **配置驱动** - 通过 YAML 配置文件管理所有设置
- 🔌 **动态加载** - 自动加载适配器和协议插件
- 🌐 **多平台支持** - 支持微信、QQ、钉钉等多个平台
- 📡 **多协议支持** - 支持 OneBot v11/v12、Satori、Milky 等协议
- 🎨 **Web 界面** - 内置管理界面（可选）
- 📊 **日志系统** - 完整的日志记录和管理

## 安装

```bash
npm install onebots
# 或
pnpm add onebots
```

## 快速开始

### 1. 创建配置文件

创建 `config.yaml`:

```yaml
# 全局配置
port: 6727              # HTTP 服务器端口
log_level: info         # 日志级别: trace, debug, info, warn, error
timeout: 30             # 登录超时时间(秒)

# 通用配置（协议默认配置）
general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ''
    secret: ''
    enable_cors: true
    heartbeat_interval: 5
    http_reverse: []
    ws_reverse: []

  satori.v1:
    use_http: true
    use_ws: true
    token: ''
    platform: 'unknown'
    webhooks: []

# 账号配置
# 格式: {platform}.{account_id}
qq.my_bot:
  # OneBot V11 协议配置
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: 'your_token'

  # QQ 平台配置
  appid: ''               # QQ 机器人 AppID（v4 起字段名为 appid）
  secret: ''              # QQ 机器人 secret
  mode: websocket         # websocket（默认）或 webhook
  sandbox: false          # 是否沙箱环境
  intents:
    - 'GROUP_AND_C2C_EVENT'
    - 'PUBLIC_GUILD_MESSAGES'

wechat.my_wechat_mp:
  # OneBot V11 协议配置
  onebot.v11:
    use_http: true
    use_ws: true

  # 微信平台配置
  app_id: your_app_id
  app_secret: your_app_secret
  token: your_token
```

### 2. 启动应用

#### 使用命令行

```bash
# 直接启动
npx onebots

# 指定配置文件
npx onebots -c config.yaml

# 注册适配器和协议
npx onebots -r wechat -p onebot-v11 -p satori-v1
```

#### 使用代码

```typescript
import { App } from 'onebots';
import { WeChatAdapter } from '@onebots/adapter-wechat';
import { OneBotV11Protocol } from '@onebots/protocol-onebot-v11';

// 注册适配器和协议
await App.registerAdapter('wechat', WeChatAdapter);
await App.registerProtocol('onebot', OneBotV11Protocol, 'v11');

// 创建应用（可选传入配置）
const app = new App({
  port: 6727,
  log_level: 'info',
  // 或者不传参数，使用 config.yaml
});

await app.start();
```

## 命令行参数

```bash
onebots [options]                 # 前台运行
onebots run [options]             # 显式前台运行
onebots install [options]         # 安装用户级服务
onebots start|stop|restart        # 控制用户级服务
onebots status|logs|uninstall

# 添加 --system 后操作系统级服务
onebots install --system [options]
onebots start --system

# 辅助命令
onebots setup
onebots ui [--web]
onebots doctor [--fix] [--json] [--strict]
onebots update [--check] [--yes]

选项:
  -c, --config <path>        配置文件路径 (默认: config.yaml)
  -r, --register <adapter>   注册适配器 (可多次使用)
  -p, --protocol <protocol>  注册协议 (可多次使用)
  -h, --help                 显示帮助信息
```

`install` 会先按前台启动的真实路径动态加载当前 `-r` / `-p` 插件，确认插件注册了 CLI 名称对应的工厂与配置 Schema，并校验 `-c` 指向的完整配置。插件事务只能修改该 CLI 名称承诺的工厂、元数据与 Schema；额外注册其他适配器或协议、冒领导入前已有的注册身份、初始化失败、注册契约不完整或配置无效时都会回滚，并且不会写入服务定义。同一包重复加载保持幂等，协议的不同版本可以共享协议元数据并分别注册。预检通过后，它会记录这些参数与运行路径并设置开机或登录自启，但不立即启动。`start` 和 `restart` 会根据保存的工作目录与插件列表重新预检当前环境；重启预检失败时不会先停止正在运行的实例。重复执行 `install` 会更新固定的 `onebots-gateway` 服务。`uninstall` 不会删除配置、数据库或日志。

`status` 不只读取进程管理器，还会在进程运行时探测 `/health` 与 `/ready`，显示“已就绪”“待配置”“版本未验证”或“不可用”。它会把在线主程序版本与当前 CLI 对比；版本缺失或不一致、服务已安装但未运行、探针失败均返回退出码 `1`，未安装返回 `2`，可直接用于部署脚本。

`doctor` 默认把首次配置期间可继续处理的状态保留为警告。部署门禁应添加 `--strict`，此时任一警告也会令 JSON 中的 `ok` 为 `false` 并返回退出码 `1`，避免未配置账号、服务未安装或已停止、未完成管理面验证的实例被当作生产可用。

在线诊断还会读取 `/health` 中实际运行的 `onebots` 主程序版本，并与当前 CLI 对比。版本不一致或旧进程无法声明版本时会产生警告，`--strict` 会阻止部署继续；Core 版本会单独显示，避免把依赖版本误当成主程序版本。

`update` 不会只相信包管理器的成功退出码：依赖命令结束后会逐个读取 OneBots 与所选插件的实际包清单，确认全部等于查询到的目标版本，任何缺失或偏差都会在服务预检、定义改写和重启前终止。校验通过后，更新后的 CLI 子进程会重新加载服务插件并校验配置；只有预检成功才更新服务定义并重启。重启后还会等待 `/health` 声明 `onebots` 应用身份与目标版本，并确认 `/ready` 可用或仍处于允许继续配置的首次部署状态；超时会保留最后一次探针证据并返回失败，不会把“重启命令已执行”误报为更新成功。预检失败时当前运行实例保持不变，但磁盘上的依赖已经更新，应根据错误修复或使用包管理器回退后重试。交互模式选择暂不重启时，命令会明确提示运行中的仍是旧实例，随后可执行 `onebots restart` 完成切换。

### v2 CLI 迁移

| v1 命令 | v2 命令 |
|---|---|
| `onebots gateway start` | `onebots run` |
| `onebots gateway daemon` | `onebots install` 后执行 `onebots start` |
| `onebots gateway stop` | `onebots stop` |
| `onebots gateway service install` | `onebots install` |
| `onebots gateway service status` | `onebots status` |
| `onebots gateway service uninstall` | `onebots uninstall` |

v2 不再接受 `gateway` / `service` / `daemon` 命令层级。默认命令操作用户级服务，需要系统级服务时添加 `--system`。

### CLI 架构

CLI 使用 Pastel 的文件路由：`src/commands` 中的文件名就是公开命令，Zod schema 统一负责参数类型和帮助信息。路由组件只承担交互展示，实际行为位于 `src/cli/command-application.ts`、runtime 和 service controller 等无 UI 模块中。

裸 `onebots` 会在进程入口规范化为 `onebots run`，因此两种写法经过同一个路由。系统服务仍记录公开 CLI 入口，但通过内部的无 TTY runtime 通道启动，守护进程不会加载 Pastel/Ink。新增公开命令时应增加独立路由文件，而不是修改中央命令注册表。

## 配置说明

### 配置文件结构

onebots 使用 YAML 格式的配置文件，采用**账号标识 + 协议配置**的方式：

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

### 全局配置

```yaml
# HTTP 服务器端口
port: 6727

# 日志级别: trace, debug, info, warn, error
log_level: info

# 登录超时时间(秒)
timeout: 30
```

### 通用配置(general)

为协议提供默认配置，账号未指定时使用：

```yaml
general:
  onebot.v11:
    use_http: true              # 启用 HTTP
    use_ws: true                # 启用 WebSocket
    access_token: ''            # 访问令牌
    secret: ''                  # 签名密钥
    enable_cors: true           # 启用 CORS
    heartbeat_interval: 5       # 心跳间隔(秒)
    http_reverse: []            # HTTP 反向推送地址
    ws_reverse: []              # WebSocket 反向连接地址

  onebot.v12:
    use_http: true
    use_ws: true
    access_token: ''
    enable_cors: true
    heartbeat_interval: 5
    webhooks: []                # HTTP Webhook 地址
    ws_reverse: []
    request_timeout: 15         # 请求超时(秒)

  satori.v1:
    use_http: true
    use_ws: true
    token: ''                   # 访问令牌
    platform: 'unknown'         # 平台名称
    webhooks: []                # Webhook 地址

  milky.v1:
    use_http: true
    use_ws: true
    access_token: ''
    secret: ''
    heartbeat: 5                # 心跳间隔(秒)
    http_reverse: []
    ws_reverse: []
```

### 账号配置

账号标识格式：`{platform}.{account_id}`

```yaml
# QQ 机器人示例
qq.my_bot:
  # 可以同时配置多个协议
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: 'qq_v11_token'

  satori.v1:
    use_http: true
    use_ws: true
    token: 'qq_satori_token'
    platform: 'qq'

  # QQ 平台配置
  appid: ''                     # QQ 机器人 AppID（v4 起字段名为 appid）
  secret: ''                    # QQ 机器人 secret
  mode: websocket               # websocket（默认）或 webhook
  sandbox: false                # 是否沙箱环境
  intents:                      # 需要监听的 intents
    - 'GROUP_AND_C2C_EVENT'
    - 'PUBLIC_GUILD_MESSAGES'

# 微信公众号示例
wechat.my_wechat_mp:
  onebot.v11:
    use_http: true
    use_ws: true

  # 微信平台配置
  app_id: your_app_id
  app_secret: your_app_secret
  token: your_token
  encoding_aes_key: ''          # 消息加解密密钥(可选)

# Kook (开黑啦) 示例
kook.my_kook_bot:
  onebot.v11:
    use_http: true
    use_ws: true

  satori.v1:
    use_http: true
    use_ws: true
    token: 'kook_token'
    platform: 'kook'

  # Kook 平台配置
  token: ''                     # Kook Bot Token
```

### 配置优先级

```
账号协议配置 > general 默认配置
```

账号下指定的协议配置会覆盖 general 中的默认值。

## API 参考

### App 类

```typescript
class App extends BaseApp {
  constructor(config?: {
    port?: number;           // HTTP 端口
    log_level?: string;      // 日志级别
    timeout?: number;        // 超时时间
    // ... 其他配置
  });

  // 启动应用（自动读取 config.yaml）
  start(): Promise<void>;

  // 停止应用
  stop(force?: boolean): Promise<void>;
}
```

### App 命名空间

```typescript
namespace App {
  // 注册通用配置
  function registerGeneral<K>(
    key: K,
    config: Protocol.Config
  ): void;

  // 注册适配器
  function registerAdapter(
    platform: string,
    factory?: Adapter.Factory
  ): Promise<void>;

  // 注册协议
  function registerProtocol(
    name: string,
    factory?: Protocol.Factory,
    version?: string
  ): Promise<void>;

  // 加载适配器工厂
  function loadAdapterFactory(
    platform: string
  ): Promise<Adapter.Factory>;

  // 加载协议工厂
  function loadProtocolFactory(
    name: string,
    version?: string
  ): Promise<Protocol.Factory>;
}
```

## 插件系统

### 自动加载

onebots 会自动尝试加载以下格式的包：

**适配器:**
- `@onebots/adapter-{platform}`
- `onebots-adapter-{platform}`
- `{platform}`

**协议:**
- `@onebots/protocol-{name}-{version}`
- `onebots-protocol-{name}-{version}`
- `{name}`

### 手动注册

```typescript
import { App } from 'onebots';
import MyAdapter from './my-adapter';
import MyProtocol from './my-protocol';

// 注册自定义适配器
await App.registerAdapter('myplatform', MyAdapter);

// 注册自定义协议
await App.registerProtocol('myprotocol', MyProtocol, 'v1');
```

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 启动（开发模式）
pnpm start
```

## 官方插件

### 适配器

- [@onebots/adapter-wechat](../adapter-wechat) - 微信公众号适配器

### 协议

- [@onebots/protocol-onebot-v11](../protocol-onebot-v11) - OneBot V11 协议
- [@onebots/protocol-onebot-v12](../protocol-onebot-v12) - OneBot V12 协议
- [@onebots/protocol-satori-v1](../protocol-satori) - Satori 协议
- [@onebots/protocol-milky-v1](../protocol-milky-v1) - Milky V1 协议

## 示例项目

查看 [test](../../test) 目录获取完整的使用示例。

## 许可证

MIT License - 查看 [LICENSE](../../LICENSE) 文件了解详情

## 作者

凉菜

## 相关链接

- [onebots 文档](../../docs)
- [GitHub 仓库](https://github.com/lc-cn/onebots)
