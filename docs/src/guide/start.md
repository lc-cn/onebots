# 快速开始

本指南将帮助你快速部署 onebots 服务。

## 什么是 onebots？

onebots 是一个**多平台多协议机器人应用框架**，提供完整的服务端和客户端解决方案：

- **平台层**：QQ、微信、钉钉、飞书、企业微信、Telegram、Slack、Discord、Kook、Microsoft Teams 等各大平台的机器人 API
- **onebots（服务端）**：统一的协议转换层，将平台 API 转换为标准协议
- **标准协议**：OneBot V11/V12、Satori、Milky 等标准协议接口
- **imhelper（客户端SDK）**：统一的客户端接口，抹平协议差异
- **框架层**：Koishi、NoneBot、Yunzai 等机器人应用框架

```
平台 API (QQ、微信、钉钉、飞书、Telegram、Slack...)
        ↓
    onebots (服务端) ← 本项目服务端
        ↓
标准协议 (OneBot、Satori...)
        ↓
    imhelper (客户端SDK) ← 本项目客户端
        ↓
机器人框架 (Koishi、NoneBot...)
```

**使用场景**：
- **服务端场景**：当你想用 Koishi 等框架开发机器人，但平台不直接支持时，onebots 服务端可以作为桥梁
- **客户端场景**：当你需要开发跨协议的机器人应用时，imhelper 提供统一的客户端接口，无需关心底层协议差异

## 前置要求

- Node.js >= 22
- pnpm / npm / yarn（推荐使用 pnpm）

## 安装

### 全局安装

```bash
npm install -g onebots
# 或
pnpm add -g onebots
```

### 项目安装

```bash
npm install onebots
# 或
pnpm add onebots
```

## 工作原理

1. **配置平台账号**：在配置文件中填写平台机器人的认证信息
2. **加载适配器**：onebots 使用对应适配器连接平台（如微信适配器）
3. **选择协议**：指定要提供的协议接口（如 OneBot V11、Satori）
4. **启动服务**：onebots 开始监听并转换消息
5. **框架接入**：机器人框架通过标准协议与 onebots 通信

## 创建配置文件

在项目根目录创建 `config.yaml` 文件：

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
    enable_cors: true
    heartbeat_interval: 5

# 账号配置
# 格式: {platform}.{account_id}
wechat.my_wechat_mp:
  # 协议配置
  onebot.v11:
    use_http: true
    use_ws: true
  
  # 微信平台配置
  app_id: your_app_id
  app_secret: your_app_secret
  token: your_token
```

完整配置示例请查看 [配置文件说明](/config/global)。

## 启动服务

### Docker 部署（推荐用于生产）

若已安装 Docker，可直接用镜像运行，无需在宿主机安装 Node.js。详见 [Docker 部署](/guide/docker)。

```bash
# 使用 docker compose
docker compose up -d

# 或使用 docker run
docker run -d -p 6727:6727 -v $(pwd)/data:/data onebots
```

### 方式一：命令行（推荐）

```bash
# 基础用法：指定适配器和协议
onebots -r wechat -p onebot-v11

# 自定义配置文件
onebots -r wechat -p onebot-v11 -c config.yaml

# 同时启用多个协议（一个账号对外提供多个协议接口）
onebots -r wechat -p onebot-v11 -p onebot-v12 -p satori-v1
```

**命令行参数说明：**

| 参数 | 说明 | 示例 |
|------|------|------|
| `-r, --register` | 加载平台适配器 | `-r wechat` |
| `-p, --protocol` | 启用协议接口 | `-p onebot-v11` |
| `-c, --config` | 指定配置文件 | `-c config.yaml` |

### 方式二：代码启动

创建 `index.js` 或 `index.ts`：

```javascript
import { App } from 'onebots';
import { WeChatAdapter } from '@onebots/adapter-wechat';
import { OneBotV11Protocol } from '@onebots/protocol-onebot-v11';

// 注册适配器和协议
await App.registerAdapter('wechat', WeChatAdapter);
await App.registerProtocol('onebot', OneBotV11Protocol, 'v11');

// 创建并启动转换服务
const app = new App();
await app.start();
```

运行：

```bash
node index.js
# 或使用 TypeScript
tsx index.ts
```

## 安装插件

### 平台适配器

根据你要接入的平台安装对应适配器：

```bash
# 微信公众号
npm install @onebots/adapter-wechat
```

更多适配器：[适配器列表](/guide/adapter)

### 协议实现

根据下游框架支持的协议安装：

```bash
# OneBot V11（Koishi、NoneBot2 等）
npm install @onebots/protocol-onebot-v11

# OneBot V12（新版本框架）
npm install @onebots/protocol-onebot-v12

# Satori（Koishi、Chronocat 等）
npm install @onebots/protocol-satori-v1

# Milky（轻量级协议）
npm install @onebots/protocol-milky-v1
```

## 验证服务

成功启动后会看到类似日志：

```log
[2025-11-29 12:00:00] [MARK] [onebots] - server listen at http://0.0.0.0:6727/
[2025-11-29 12:00:00] [INFO] [onebots:wechat] - Starting adapter for platform wechat
[2025-11-29 12:00:00] [INFO] [onebots:my_wechat_mp] - Starting account my_wechat_mp
[2025-11-29 12:00:00] [INFO] [onebots:onebot/v11] - Starting HTTP server
[2025-11-29 12:00:00] [INFO] [onebots:onebot/v11] - HTTP server listening on /wechat/my_wechat_mp/onebot/v11/:action
```

看到以上输出说明服务已正常运行。

## 接入机器人框架

服务启动后，即可在机器人框架中配置连接。

### HTTP 接口

**OneBot V11 HTTP API 格式：**
```
http://localhost:6727/{platform}/{account_id}/onebot/v11/{action}
```

**配置示例（以 Koishi 为例）：**
```yaml
plugins:
  onebot:
    endpoint: http://localhost:6727/wechat/my_wechat_mp/onebot/v11
```

**测试连接：**
```bash
# 调用发送消息接口测试
curl -X POST http://localhost:6727/wechat/my_wechat_mp/onebot/v11/send_private_msg \
  -H "Content-Type: application/json" \
  -d '{"user_id": "123456", "message": "Hello"}'
```

### WebSocket 接口

**OneBot V11 WebSocket 格式：**
```
ws://localhost:6727/{platform}/{account_id}/onebot/v11
```

在框架的 WebSocket 配置中填入此地址即可接收事件推送。

## 使用客户端SDK

除了通过机器人框架接入，你也可以直接使用 imhelper 客户端SDK 来开发机器人应用。

详细说明请查看：[客户端SDK使用指南](/guide/client-sdk)

## 下一步

- 📚 [配置文件详解](/zh/config/global)
- 💻 [客户端SDK使用指南](/zh/guide/client-sdk)
- 🔌 [开发自定义适配器](/zh/guide/adapter)
- 📡 [协议说明](/zh/protocol/onebot-v11/index)
- 🛠️ [API 参考](/zh/protocol/onebot-v11/action)

