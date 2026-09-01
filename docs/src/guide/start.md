# 快速开始

## 一键安装（推荐）

Linux 和 macOS 可以运行官方安装脚本。脚本会检查 Node.js 版本，在独立目录安装 Node.js 24、OneBots、Web 管理端和默认 OneBot v11 协议，创建安全配置，并注册为用户级常驻服务。它会先安装 OneBots 及其匹配的 Web 依赖，再从主包发布的扩展版本目录读取默认协议版本；Web 入口缺失或协议落盘版本不一致时，会在创建配置和服务前停止：

```bash
curl -fsSL https://raw.githubusercontent.com/lc-cn/onebots/master/install.sh | sh
```

安装完成后，终端只需用于查看首次登录地址和鉴权码。后续可在 Web 管理端的“功能扩展”页面先比较 Slack、Telegram 等平台适配器的版本化能力快照，再选择安装；服务自动重启后，页面会改用插件实际注册的能力清单，并通过分步说明引导准备平台凭据和填写账号配置。每个适配器和协议都显示当前 OneBots 验证的精确包版本；安装只使用该版本，不会静默追随 npm `latest`。若手工安装的版本不同，页面会同时展示两个版本并允许切换回验证版本。扩展中心会在下载依赖前校验当前配置，并根据运行目录的锁文件和 `packageManager` 选择 npm 或 pnpm；在 pnpm workspace 源码环境中不会误用 npm 解析 `catalog:`。依赖安装完成后，还会核对落盘版本，并用候选配置在隔离子进程中验证插件入口、注册契约与完整运行配置，只有全部通过才启用并写盘，因此损坏或不兼容的插件不会污染下一次启动。安装或预检期间若配置被其他管理操作更新，扩展选择会合并到最新配置并重新验证，避免覆盖并行修改。正式重启前会再次使用守护服务的真实工作目录预检，不会修改当前在线进程的插件状态；预检失败时当前服务保持在线，页面会显示具体原因。预检通过后，旧进程先优雅释放账号、协议和网络资源；页面记录旧 `instance_id`，只有健康端点恢复为不同的新 OneBots 实例后才自动刷新，持续由旧进程响应或身份缺失会明确超时。

首次登录尚无机器人时，「机器人管理」空状态直接提供「比较平台能力」与下一步主操作：尚未加载适配器时进入「安装平台适配器」，已有适配器时进入「添加机器人账号」。因此不需要先理解 `-r`、配置键或侧栏结构，也能从平台选型连续走到账号创建。

默认文件保存在 `~/.onebots`。可在运行脚本前设置 `ONEBOTS_HOME` 更改位置。

安装脚本可以安全重复执行。首次运行会创建配置和服务；后续运行会更新运行包，原样保留已有账号、凭据与插件选择，通过预检后更新服务定义，并重启正在使用的服务。启动命令返回后，脚本还会有限重试 `onebots status`，同时验证进程管理器、在线 OneBots 身份与版本以及 readiness；只有门禁通过才显示“安装完成”和管理地址，并且只在本次新建配置时显示首次鉴权码。重复安装不会提取或输出已有鉴权码，避免升级终端或自动化日志再次暴露长期管理凭据。任一 npm、OneBots 命令或在线验证失败时脚本都会立即停止，不会继续报告安装成功。

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/lc-cn/onebots/master/install.ps1 | iex
```

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

setup 不会写入占位平台账号；它只为本次 `-p` 实际加载的协议生成默认值，并把验证通过的适配器与协议写入 `plugins`。后续前台启动、doctor、install、update 和 MCP 模式只需指定配置文件，无需重复 `-r` / `-p`。`-c` 会保留完整配置路径，包括自定义文件名；启动后的管理 API、热重载、扩展安装、漂移检测和账号配置写回继续操作同一文件，不会悄悄切换到同目录的 `config.yaml`。即使首次 setup 尚未选择任何插件，完成信息也会给出平台能力比较、doctor 验证、前台启动和守护服务安装四个可直接执行的下一步；用户可以先查看随当前 OneBots 版本发布的离线能力目录，再进入 Web 扩展中心安装。若配置尚无管理凭据，setup 会生成 256 位随机 `access_token`，只写入权限为 `0600` 的配置文件，不把鉴权码输出到服务日志。无法读取配置文件的托管环境应预先通过 Secret 设置 `ONEBOTS_ACCESS_TOKEN`；它优先于文件配置，且不会被持久化。随后打开 `http://localhost:6727` 登录。机器人页会先确认适配器和至少一个开放协议都已加载：缺少适配器或协议时分别直达对应的扩展分类，扩展目录仍在读取时不会过早开放账号向导，目录不可达时则提供可恢复的检查入口。扩展中心会按类型提供下一步：适配器直接添加对应平台账号；协议使用目录显式声明的 Schema 键进入账号出口列表，新增或编辑账号都会直接定位并启用该协议。服务端逐项核对配置目标与插件身份，漂移时只禁用对应入口并展示原因。即使从配置页直接打开向导，平台能力加载中、加载失败、确认未安装以及账号对应适配器已卸载也会分别显示等待、重试或安装操作。账号向导还会阻止保存未启用协议出口的账号；服务端仍会在保存与启动前执行相同校验。已有配置在非交互环境默认不会覆盖；显式传入 `--force` 时会先生成 `.bak`。如果配置仍可读取，普通 `--force` 会保留账号、凭据和插件选择；插件已经卸载或配置需要彻底恢复时，使用 `onebots setup -c config.yaml --force --reset` 从安全默认值重建，原文件仍保存在 `.bak` 中，也可以同时用 `-r` / `-p` 选择新的插件。`--reset` 不与 `--force` 同时使用会被拒绝。原 YAML 已损坏时，`--force` 也会先保留原文件再安全重建。setup、前台创建入口和 `config get/set/list` 共用脱敏解析器，公开错误不会包含 YAML 源码片段或相邻凭据。

`onebots ui --web -c config.yaml` 会打开管理页面实际所在的本机 origin。宿主 `path` 只作为 Router HTTP 前缀，不会被误拼到页面地址；页面会从运行时元数据读取它。`onebots send -c config.yaml --channel <platform.account> --target_type private <target> <message>` 同样复用规范前缀和管理鉴权优先级：`ONEBOTS_ACCESS_TOKEN` 优先于文件 token；只有用户名密码时会先登录取得 Bearer 会话，并在发送成功或失败后撤销。显式 `--url` 只接受不含 URL 凭据、查询串或 fragment 的 HTTP(S) 网关根地址，避免把管理令牌发送到歧义目标。

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

# setup 会持久化默认加载的插件
plugins:
  adapters: [mock]
  protocols: [onebot-v11]

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
# setup 后直接复用配置中的插件选择
onebots -c config.yaml

# 显式参数按类别覆盖配置默认值
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
onebots doctor -c config.yaml
curl --fail http://localhost:6727/health
curl --fail http://localhost:6727/ready
```

`doctor` 会验证扩展目录中每个“去配置”入口与插件身份一致，并确认安装白名单、固定包版本和适配器能力快照形成闭合集合；`--json` 输出中的 `extension-catalog` 检查可供部署脚本和 CI 判定，缺失、孤立、版本错配或配置目标漂移时会列出全部目录项及原因。首次尚未添加账号时 `/ready` 会保持管理面可访问，并返回 `configured: false`；doctor 会明确标为警告。账号离线、协议出口启动失败，或任一账号尚未配置协议出口时，`/ready` 返回 HTTP 503。

尚未选择适配器、安装插件或创建账号时，`onebots capabilities --json` 会直接导出当前 OneBots 随包发布的全部平台能力目录；目录条目标记为 `source: "catalog"` 且 `entryPath: null`。命令会先执行与 doctor 相同的闭合校验，不能把漏项快照误报为 `complete: true`。一旦通过配置或 `-r` 选中适配器，命令会无连接加载插件，并让标记为 `source: "runtime"` 的实际注册清单优先；加载失败仍以错误码退出，同时保留可用的目录快照用于排查与选型。若 `config.yaml` 语法损坏或插件选择无效，只读查询会回退到显式 `-r` 或完整静态目录，在文本和 JSON 的 `runtime-config` 错误中保留脱敏首行并以退出码 `1` 标记结果不完整；前台启动、服务安装等写入或运行命令仍严格拒绝该配置。配置解析器本身只生成限长单行错误，不把 js-yaml 的源码片段保存在可序列化错误链中，因此 `doctor`、前台、服务预检、热重载和更新器都不会把相邻凭据写入终端、CI 或服务日志。

Web 扩展中心也执行同一门禁。目录不闭合时，页面会显示完整原因，隐藏未验证的静态能力证据，并禁用所有安装与版本切换操作；服务端在读取配置或调用包管理器前再次拒绝请求。已经加载的插件仍使用其运行时清单，现有账号配置和运行不受静态目录故障影响。

扩展卡片分别核对磁盘依赖、启动配置和当前进程，不再把所有 `installed` 状态都显示成“等待重启”。即使尚未创建账号，也可以按平台名称、描述或权威能力清单搜索，多个关键词必须落在同一平台或同一能力条目；搜索能力时只返回原生支持或可模拟实现的条目，明确不支持的声明不会把平台误列为候选，命中清单会自动展开。场景、支持级别、可用性和消息方向同时提供中文标签与原始枚举，例如“场景 群聊 · group”；因此 `群聊 file` 与 `group file` 会命中同一份清单证据。依赖安装后预检失败会明确显示“已安装，未启用”并提供“启用并重启”；配置已写入但进程尚未切换时显示“等待重启加载”；配置引用缺失依赖或当前进程仍加载已移除扩展时也会给出独立故障状态和对应恢复动作。同一扩展因断线重试或多个页面同时发起安装时会复用同一个服务端操作，不会重复运行包管理器或预检；其他扩展仍保持互斥。页面固定显示当前服务端安装，即使对应卡片被类型或能力搜索隐藏，也会在操作完成前禁用其他安装入口。扩展列表保留兼容的 `installing` 布尔值，同时给进行中的操作返回稳定的 `operationId`、`startedAt` 和 `phase`；页面会区分“安装并核验依赖”与“隔离预检”。当前服务实例还会为每个扩展保留最近一次成功或失败的操作 ID、起止时间与脱敏诊断，因此重新打开页面或其他管理页面也能解释失败；开始重试或服务重启后这份临时证据会更新或清空。长安装请求被浏览器或反向代理断开时，页面会读取操作 ID 恢复流程：服务端仍在执行就继续轮询，已产生新的成功终态就继续完成安全重启，新的失败终态则展示其诊断；旧结果不会被误当成本次成功。

扩展安装完成后，服务端还会声明当前进程是否有可验证的重启监督器。`onebots install` 创建的系统服务可以直接安全切换实例；Docker 等编排环境只有在重启策略与 `ONEBOTS_RESTARTABLE=1` 成对配置时才开放该能力。直接前台运行的 OneBots 会保留当前管理端在线，页面显示“安装完成、请手动重启”，不会先退出再等待一个永远不会出现的新实例。系统页的重启按钮使用同一证据，没有监督器时保持禁用。

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
