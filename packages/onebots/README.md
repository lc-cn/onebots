# onebots

多平台多协议的机器人应用启动器 - OneBots 主应用包

## 简介

`onebots` 是 OneBots 框架的主应用包，提供了完整的应用层功能，包括配置管理、适配器加载、协议注册等。它基于 `@onebots/core` 核心库，为开发者提供开箱即用的机器人应用解决方案。

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
  token: ''               # QQ 机器人 token
  secret: ''              # QQ 机器人 secret
  sandbox: false          # 是否沙箱环境
  intents:
    - 'GROUP_AT_MESSAGE_CREATE'
    - 'C2C_MESSAGE_CREATE'

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
onebots [options]

选项:
  -c, --config <path>        配置文件路径 (默认: config.yaml)
  -r, --register <adapter>   注册适配器 (可多次使用)
  -p, --protocol <protocol>  注册协议 (可多次使用)
  -h, --help                 显示帮助信息
```

## 配置说明

### 配置文件结构

OneBots 使用 YAML 格式的配置文件，采用**账号标识 + 协议配置**的方式：

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
  token: ''                     # QQ 机器人 token
  secret: ''                    # QQ 机器人 secret
  sandbox: false                # 是否沙箱环境
  intents:                      # 需要监听的 intents
    - 'GROUP_AT_MESSAGE_CREATE'
    - 'C2C_MESSAGE_CREATE'

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

OneBots 会自动尝试加载以下格式的包：

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
- [@onebots/protocol-satori](../protocol-satori) - Satori 协议
- [@onebots/protocol-milky-v1](../protocol-milky-v1) - Milky V1 协议

## 示例项目

查看 [test](../../test) 目录获取完整的使用示例。

## 许可证

MIT License - 查看 [LICENSE](../../LICENSE) 文件了解详情

## 作者

凉菜

## 相关链接

- [OneBots 文档](../../docs)
- [GitHub 仓库](https://github.com/lc-cn/onebots)
