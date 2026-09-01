# 快速开始

## 一键安装（推荐）

Linux 和 macOS 可以运行官方安装脚本。脚本会检查 Node.js 版本，在独立目录安装 Node.js 24、OneBots、Web 管理端和默认 OneBot v11 协议，创建安全配置，并注册为用户级常驻服务。它会先安装 OneBots 及其匹配的 Web 依赖，再从主包发布的扩展版本目录读取默认协议版本；Web 入口缺失或协议落盘版本不一致时，会在创建配置和服务前停止：

```bash
curl -fsSL https://raw.githubusercontent.com/lc-cn/onebots/master/install.sh | sh
```

安装完成后，终端只需用于查看首次登录地址和鉴权码。后续可在 Web 管理端的“功能扩展”页面先比较 Slack、Telegram 等平台适配器的版本化能力快照，再选择安装；服务自动重启后，页面会改用插件实际注册的能力清单，并通过分步说明引导准备平台凭据和填写账号配置。每个适配器和协议都显示当前 OneBots 验证的精确包版本；安装只使用该版本，不会静默追随 npm `latest`。若手工安装的版本不同，页面会同时展示两个版本并允许切换回验证版本。扩展中心会在下载依赖前校验当前配置，并根据运行目录的锁文件和 `packageManager` 选择 npm 或 pnpm；在 pnpm workspace 源码环境中不会误用 npm 解析 `catalog:`。依赖安装完成后，还会核对落盘版本，并用候选配置在隔离子进程中验证插件入口、注册契约与完整运行配置，只有全部通过才启用并写盘，因此损坏或不兼容的插件不会污染下一次启动。安装或预检期间若配置被其他管理操作更新，扩展选择会合并到最新配置并重新验证，避免覆盖并行修改。正式重启前会再次使用守护服务的真实工作目录预检，不会修改当前在线进程的插件状态；预检失败时当前服务保持在线，页面会显示具体原因。预检通过后，旧进程先优雅释放账号、协议和网络资源；页面记录旧 `instance_id`，只有健康端点恢复为不同的新 OneBots 实例后才自动刷新，持续由旧进程响应或身份缺失会明确超时。

首次登录尚无机器人时，「机器人管理」空状态直接提供「比较平台能力」与下一步主操作：尚未加载适配器时进入「安装平台适配器」，已有适配器时进入「添加机器人账号」。因此不需要先理解 `-r`、配置键或侧栏结构，也能从平台选型连续走到账号创建。

默认文件保存在 `~/.onebots`。可在运行脚本前设置 `ONEBOTS_HOME` 更改位置。

安装脚本可以安全重复执行。首次运行会创建配置和服务，并安装起步所需的默认 OneBot v11；后续运行不会强装未被现有配置选择的默认协议，而是原样保留账号、凭据与插件选择。重复安装会先记录升级前的 OneBots 主包版本，再安装新主程序，并在服务预检前执行 `onebots update --packages-only`：它从配置的 `plugins` 选择中找出全部适配器与协议，同步到新 OneBots 版本目录验证的精确版本，然后立即用真实配置和新 CLI 做隔离预检。扩展预检失败时会恢复更新前的整组依赖，安装器随后恢复旧 OneBots 主包、核对落盘版本，并用真实配置对恢复后的整套运行环境再次执行隔离预检；任一恢复失败都会保留明确诊断。这个阶段不会读取、改写或重启已有服务，因此 Slack、Milky 等后装扩展不会在重复安装后滞留旧版本，也不会把已知无法启动的新依赖留给下次机器重启。依赖事务完成后，脚本才会再次预检并更新服务定义，然后重启正在使用的服务。启动命令返回后，脚本还会有限重试 `onebots status`，同时验证进程管理器、在线 OneBots 身份与版本、readiness，以及 Web 管理页本身；只有门禁通过才读取 `status --json` 中已经按真实配置解析的 `target.webUrl`。状态证据会分别保留带 Router 前缀的 API/探针地址 `target.baseUrl` 和位于根路径的 Web 管理地址 `target.webUrl`。`management-page` 检查还会请求该 Web origin，验证 HTML 中注入的 Router 前缀与当前配置一致，并要求入口保留 `no-store` 与 `no-referrer` 安全响应头。因此自定义 `path` 前缀、带引号的端口、缺失的前端路由或错误的通用成功页都不会让安装器显示不可用的登录地址。最终状态缺少或无法验证 Web 地址证据时不会宣告安装完成。安装器只在本次新建配置时显示首次鉴权码；重复安装不会提取或输出已有鉴权码，避免升级终端或自动化日志再次暴露长期管理凭据。任一 npm、OneBots 命令或在线验证失败时脚本都会立即停止，不会继续报告安装成功。

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

setup 不会写入占位平台账号；它只为本次 `-p` 实际加载的协议生成默认值，并把验证通过的适配器与协议写入 `plugins`。后续前台启动、doctor、install、update 和 MCP 模式只需指定配置文件，无需重复 `-r` / `-p`。`-c` 会保留完整配置路径，包括自定义文件名；启动后的管理 API、热重载、扩展安装、漂移检测和账号配置写回继续操作同一文件，不会悄悄切换到同目录的 `config.yaml`。即使首次 setup 尚未选择任何插件，完成信息也会给出平台能力比较、doctor 验证、前台启动和守护服务安装四个可直接执行的下一步；用户可以先查看随当前 OneBots 版本发布的离线能力目录，再进入 Web 扩展中心安装。若配置尚无管理凭据，setup 会生成 256 位随机 `access_token`，只写入权限为 `0600` 的配置文件，不把鉴权码输出到服务日志。复用文件内持久化管理凭据时，setup 还会在创建数据目录或报告就绪前复用 doctor 的 POSIX 文件、备份和父目录权限判定；公开可读、同组可写或可被其他用户替换的配置会保持原样并失败，`0640` 等有意的组只读部署会保留并显示安全提示。无法读取配置文件的托管环境应预先通过 Secret 设置 `ONEBOTS_ACCESS_TOKEN`；它优先于文件配置，且不会被持久化。setup 还会输出可直接打开的 Web 管理 origin，使用配置端口且不会误拼只供 Router 使用的 `path`，也不会把 token 放进 URL。当前 shell 的 `PORT` 与配置端口不同时，会分别标明前台启动地址和守护服务配置地址；无效 `PORT` 会在创建配置或数据目录前失败。机器人页会先确认适配器和至少一个开放协议都已加载：缺少适配器或协议时分别直达对应的扩展分类，扩展目录仍在读取时不会过早开放账号向导，目录不可达时则提供可恢复的检查入口。扩展中心会按类型提供下一步：适配器直接添加对应平台账号；协议使用目录显式声明的 Schema 键进入账号出口列表，新增或编辑账号都会直接定位并启用该协议。服务端逐项核对配置目标与插件身份，漂移时只禁用对应入口并展示原因。即使从配置页直接打开向导，平台能力加载中、加载失败、确认未安装以及账号对应适配器已卸载也会分别显示等待、重试或安装操作。账号向导还会阻止保存未启用协议出口的账号；服务端仍会在保存与启动前执行相同校验。手写 YAML 时，账号键必须包含身份并采用 `{platform}.{account_id}`；若把已加载平台单独写成顶层 `telegram:` 或 `slack:`，前台启动、doctor 和服务预检会直接指出缺少账号 ID，不会把凭据节点静默忽略成零账号部署。已有配置在非交互环境默认不会覆盖；此时若 `-r` / `-p` 请求的插件集合与文件不同，setup 会在加载插件、创建数据目录或报告成功前明确拒绝并提示添加 `--force`，相同集合仍可用于幂等验证。setup 还会绑定最初读取的配置文件身份、内容与权限；插件加载和 Schema 验证期间若另一进程更新、替换或首次创建该文件，本次操作会在写配置或创建数据目录前失败，并要求基于最新文件重新执行。候选配置原子写入后，setup 会按预先规范化的目标再次核对真实路径、精确内容与文件权限，并重新检查配置、备份和父目录的凭据安全证据；写后发生替换、改写、权限放宽或目录变得可替换时会保留当前文件并拒绝输出“配置已就绪”。如果该文件没有完整管理凭据且环境也未提供 `ONEBOTS_ACCESS_TOKEN`，setup 会保持文件和数据目录不变并明确失败，避免把启动后必须隐式写入的配置误报为就绪。此时可设置环境 Secret，或显式传入 `--force` 先生成 `.bak` 再安全补齐鉴权码。如果配置仍可读取，普通 `--force` 会保留账号、已有凭据和插件选择；插件已经卸载或配置需要彻底恢复时，使用 `onebots setup -c config.yaml --force --reset` 从安全默认值重建，原文件仍保存在 `.bak` 中，也可以同时用 `-r` / `-p` 选择新的插件。`--reset` 不与 `--force` 同时使用会被拒绝。原 YAML 已损坏时，`--force` 也会先保留原文件再安全重建。setup、前台创建入口和 `config get/set/list` 共用脱敏解析器，公开错误不会包含 YAML 源码片段或相邻凭据；`config set` 会先拒绝空路径段与原型链保留字段，再按基础 Schema 或现有字段类型解析值。数字形式的 token、账号 ID 和平台密钥仍保持字符串，端口与超时继续写为数字，路径或类型不兼容时不会改动文件。成功写入会原子替换、同步写盘并保留同权限的 `.bak`，避免修改凭据时扩大原文件权限或留下截断文件。

账号身份由 core 统一验证，因为它同时组成配置键和协议 URL 路径。别名可使用 Unicode、`@`、冒号、连字符、下划线和内部点号；空白、控制字符、`/`、`\\`、`%`、`?`、`#` 以及单独的 `.` / `..` 会在 Web 向导、账号管理 API、启动、热重载、doctor 和服务预检的共同边界被拒绝。`telegram.bot.eu` 仍会被解析为平台 `telegram`、账号 `bot.eu`，不会在第二个点号处截断。

`onebots ui --web -c config.yaml` 会打开管理页面实际所在的本机 origin。宿主 `path` 只作为 Router HTTP 前缀，不会被误拼到页面地址；页面会从运行时元数据读取它。`onebots send -c config.yaml --channel <platform.account> --target_type private <target> <message>` 同样复用规范前缀和管理鉴权优先级：`ONEBOTS_ACCESS_TOKEN` 优先于文件 token；只有用户名密码时会先登录取得 Bearer 会话，并在发送成功或失败后撤销。发送命令会先用不含凭据的 `/health` 探针确认目标是与当前 CLI 同版本的 OneBots，再把登录和发送绑定到该进程的 `instance_id`；只有响应头和 JSON 成功回执均证明来自同一实例时才报告成功。显式 `--url` 只接受不含 URL 凭据、查询串或 fragment 的 HTTP(S) 网关根地址，避免把管理令牌发送到歧义目标。

如果通过 `ONEBOTS_EXTENSION_ROOT` 把依赖安装到独立运行目录，请在同一环境中执行 `onebots install`。安装命令会把该扩展根固化为服务的工作目录，使 Web 扩展中心安装依赖、隔离预检和守护进程重启后的插件解析始终使用同一位置；从其他 shell 目录执行不会再写入错误的 `WorkingDirectory`。`onebots doctor` 会单独验证扩展根与已安装服务工作目录的真实路径是否一致，发现旧定义或环境漂移时要求重新安装服务定义。

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

尚未选择适配器、安装插件或创建账号时，`onebots capabilities --json` 会直接导出当前 OneBots 随包发布的全部平台能力目录；目录条目标记为 `source: "catalog"` 且 `entryPath: null`。JSON 使用 `schemaVersion: 1` 的稳定证据 envelope，记录生成时间、当前 OneBots 名称与版本、绝对配置路径，以及本次范围来自 CLI 显式选择、配置选择还是完整随包目录；归档结果无需依赖调用参数就能证明清单针对哪套生成器和选择范围。`evidenceDigest` 是带 `sha256:` 前缀的稳定内容摘要，覆盖生成器身份、选择范围、完整性、错误和全部能力条目；生成时间、配置绝对路径与集合顺序不参与计算，因此 CI 可以直接比较不同主机或时刻生成的同一份证据。运行时插件也只以包名和版本绑定身份，兼容字段 `entryPath` 固定为 `null`，不会额外把插件安装目录、包管理器缓存路径或容器中的插件文件布局写入归档。文本输出也在首行显示相同的范围摘要。命令会先执行与 doctor 相同的闭合校验，不能把漏项快照误报为 `complete: true`。一旦通过配置或 `-r` 选中适配器，命令会无连接加载插件，并让标记为 `source: "runtime"` 的实际注册清单优先；加载失败仍以错误码退出，同时保留可用的目录快照用于排查与选型。若 `config.yaml` 语法损坏或插件选择无效，只读查询会回退到显式 `-r` 或完整静态目录，在文本和 JSON 的 `runtime-config` 错误中保留脱敏首行并以退出码 `1` 标记结果不完整；前台启动、服务安装等写入或运行命令仍严格拒绝该配置。配置解析器本身只生成限长单行错误，不把 js-yaml 的源码片段保存在可序列化错误链中，因此 `doctor`、前台、服务预检、热重载和更新器都不会把相邻凭据写入终端、CI 或服务日志。

Web 扩展中心也执行同一门禁。目录不闭合时，页面会显示完整原因，隐藏未验证的静态能力证据，并禁用所有安装与版本切换操作；服务端在读取配置或调用包管理器前再次拒绝请求。已经加载的插件仍使用其运行时清单，现有账号配置和运行不受静态目录故障影响。运行时清单只有同时声明能力和插件版本时才标记为已验证；版本无法识别时仍可浏览声明内容，但页面明确提示它不能绑定到可归档的软件包版本。

扩展卡片分别核对磁盘依赖、启动配置和当前进程，不再把所有 `installed` 状态都显示成“等待重启”。即使尚未创建账号，也可以按平台名称、描述或权威能力清单搜索，多个关键词必须落在同一平台或同一能力条目；搜索能力时只返回原生支持或可模拟实现的条目，明确不支持的声明不会把平台误列为候选，命中清单会自动展开。场景、支持级别、可用性和消息方向同时提供中文标签与原始枚举，例如“场景 群聊 · group”；因此 `群聊 file` 与 `group file` 会命中同一份清单证据。依赖安装后预检失败会明确显示“已安装，未启用”并提供“启用并重启”；配置已写入但进程尚未切换时显示“等待重启加载”；配置引用缺失依赖或当前进程仍加载已移除扩展时也会给出独立故障状态和对应恢复动作。同一扩展因断线重试或多个页面同时发起安装时会复用同一个服务端操作，不会重复运行包管理器或预检；其他扩展仍保持互斥。页面固定显示当前服务端安装，即使对应卡片被类型或能力搜索隐藏，也会在操作完成前禁用其他安装入口。扩展列表保留兼容的 `installing` 布尔值，同时给进行中的操作返回稳定的 `operationId`、`startedAt` 和 `phase`；页面会区分“安装并核验依赖”与“隔离预检”。当前服务实例还会为每个扩展保留最近一次成功或失败的操作 ID、起止时间与脱敏诊断，因此重新打开页面或其他管理页面也能解释失败；开始重试或服务重启后这份临时证据会更新或清空。长安装请求被浏览器或反向代理断开时，页面会读取操作 ID 恢复流程：服务端仍在执行就继续轮询，已产生新的成功终态就继续完成安全重启，新的失败终态则展示其诊断；旧结果不会被误当成本次成功。

已启用扩展还提供“停用并重启”。停用只从 `plugins` 的下一次启动选择中移除对应适配器或协议，不会卸载磁盘依赖，因此之后可以快速重新启用。服务端会先用候选配置执行同一套隔离启动预检；仍有机器人账号或协议出口引用该扩展时，操作会返回具体诊断并保持原配置不变。停用操作会公开稳定的操作 ID、开始时间以及最近一次成功或失败终态；浏览器或反向代理在长预检期间断开时，页面会继续等待同一操作，成功后恢复安全重启，失败则展示服务端保留的脱敏诊断。临时读取扩展目录失败也会有限重试，不会把未知状态直接当作失败或重新发起停用。写入成功后，受监督服务会完成可验证重启；前台进程则保持在线，并明确要求手动重启以结束当前进程中已经加载的扩展。

停用并完成重启后，扩展卡片会提供“卸载磁盘依赖”。OneBots 只有在启动配置已移除该扩展、当前进程也确认不再加载它，并且磁盘包身份和版本可验证时才调用包管理器。卸载不会再次改写配置，也不要求第二次重启；包管理器非零退出或卸载后校验失败时，只要依赖、清单或锁文件已经发生变化，就会精确恢复原版本并复验元数据。卸载同样发布稳定操作 ID 与成功或失败终态，浏览器断线后会继续确认原事务，不会重复执行删除。

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
