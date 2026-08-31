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

- Node.js >= 24
- pnpm >= 9.12.0，或 npm（源码开发固定使用 pnpm 9.15.9）

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

## 推荐：生成安全起步配置

先安装要使用的插件，再让 setup 根据实际加载的 Schema 生成配置。以下命令使用不连接外部平台的 Mock 适配器：

```bash
pnpm add onebots @onebots/adapter-mock @onebots/protocol-onebot-v11
pnpm exec onebots setup -c config.yaml -r mock -p onebot-v11
```

setup 不会写入占位平台账号；它只为本次 `-p` 实际加载的协议生成默认值，并输出一条可直接执行的前台启动命令。若配置尚无管理凭据，setup 会生成 256 位随机 `access_token`，只写入权限为 `0600` 的配置文件，不把鉴权码输出到服务日志。随后打开 `http://localhost:6727`，从配置文件读取 `access_token` 登录，在「配置管理」添加账号，并为该账号至少选择一个已加载协议。缺少协议出口的账号会在保存或启动前被拒绝。已有配置在非交互环境默认不会覆盖，显式传入 `--force` 时会先生成 `.bak`。

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
access_token: "replace-with-a-long-random-token" # Web 管理端与管理 API 鉴权码

# 起步配置不引用尚未加载的协议，也不使用空凭据连接平台
general: {}

# 登录 Web 管理端后添加账号，键格式为 {platform}.{account_id}
```

完整配置示例请查看 [配置文件说明](/config/global)。

## 启动服务

### Docker 部署（推荐用于生产）

若已安装 Docker，可直接用镜像运行，无需在宿主机安装 Node.js。详见 [Docker 部署](/guide/docker)。

```bash
# 使用 docker compose
docker compose up -d

# 或使用 docker run
docker run -d -p 6727:6727 -v $(pwd)/data:/data ghcr.io/lc-cn/onebots:master
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
import '@onebots/adapter-wechat'
import '@onebots/protocol-onebot-v11'
import { createOnebots } from 'onebots'

// 插件入口在导入时注册；配置仍使用与 CLI 相同的 config.yaml
const app = createOnebots('config.yaml')
await app.start()
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

不要只依赖启动日志。使用 doctor 和健康端点验证服务、账号与协议出口：

```bash
onebots doctor -c config.yaml -r wechat -p onebot-v11
curl --fail http://localhost:6727/health
curl --fail http://localhost:6727/ready
```

首次尚未添加账号时 `/ready` 会保持管理面可访问，并返回 `configured: false`；doctor 会明确标为警告。账号离线、协议出口启动失败，或任一账号尚未配置协议出口时，`/ready` 返回 HTTP 503。

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

- 📚 [配置文件详解](/config/global)
- 💻 [客户端 SDK 使用指南](/guide/client-sdk)
- 🔌 [适配器与扩展开发](/guide/adapter)
- 📡 [OneBot V11 协议](/protocol/onebot-v11/)
