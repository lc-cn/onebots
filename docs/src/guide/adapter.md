# 适配器配置指南

::: tip
`onebots` 基于适配器驱动，使用之前请先安装对应适配器所需的依赖

如已安装，请忽略
:::

## 支持的适配器

onebots 目前支持以下平台适配器：

| 平台 | 状态 | 包名 | 说明 |
|------|------|------|------|
| **QQ官方机器人** | ✅ 已实现 | `@onebots/adapter-qq` | 支持QQ频道、群聊、私聊 |
| **ICQQ** | ✅ 已实现 | `@onebots/adapter-icqq` | 支持QQ非官方协议，功能更完整 |
| **Kook** | ✅ 已实现 | `@onebots/adapter-kook` | 支持频道、私聊、服务器管理 |
| **黑盒语音** | ✅ Beta | `@onebots/adapter-heychat` | 支持斜杠命令、频道消息、WebSocket |
| **微信** | ✅ 已实现 | `@onebots/adapter-wechat` | 支持微信公众号 |
| **微信 ClawBot (iLink)** | ✅ 已实现 | `@onebots/adapter-wechat-clawbot` | 微信 iLink Bot HTTP，扫码登录与长轮询 |
| **Discord** | ✅ 已实现 | `@onebots/adapter-discord` | 支持Discord机器人 |
| **Telegram** | ✅ 已实现 | `@onebots/adapter-telegram` | 支持私聊、群组、频道 |
| **飞书** | ✅ 已实现 | `@onebots/adapter-feishu` | 支持单聊、群聊、富文本消息 |
| **钉钉** | ✅ 已实现 | `@onebots/adapter-dingtalk` | 支持企业内部应用和自定义机器人 |
| **Slack** | ✅ 已实现 | `@onebots/adapter-slack` | 支持频道消息、私聊、应用命令 |
| **企业微信** | ✅ 已实现 | `@onebots/adapter-wecom` | 支持应用消息推送、通讯录同步 |
| **Microsoft Teams** | ✅ 已实现 | `@onebots/adapter-teams` | 支持频道消息、私聊、自适应卡片 |
| **Line** | ✅ 已实现 | `@onebots/adapter-line` | 支持Line机器人消息和事件 |
| **Email** | ✅ 已实现 | `@onebots/adapter-email` | 支持SMTP发送和IMAP接收邮件 |
| **WhatsApp** | ✅ 已实现 | `@onebots/adapter-whatsapp` | 支持WhatsApp Business API |
| **Zulip** | ✅ 已实现 | `@onebots/adapter-zulip` | 支持Zulip流和私信 |
| **Matrix** | ✅ 已实现 | `@onebots/adapter-matrix` | 支持 Client-Server API、AppService 与手动接入 |
| **Google Chat** | ✅ 已实现 | `@onebots/adapter-google-chat` | 支持 Interaction HTTPS、Workspace Events 与手动接入 |
| **Facebook Messenger** | ✅ 已实现 | `@onebots/adapter-facebook-messenger` | 支持 Messenger Platform、Graph API、Webhook 与手动接入 |
| **Instagram Messaging** | ✅ 已实现 | `@onebots/adapter-instagram` | 支持 Instagram Login、Messaging、Graph API、Webhook 与手动接入 |
| **Mattermost** | ✅ 已实现 | `@onebots/adapter-mattermost` | 支持 REST API v4、可靠 WebSocket、已有 socket 与手动接入 |
| **Twitch** | ✅ 已实现 | `@onebots/adapter-twitch` | 支持 Helix、EventSub WebSocket/Webhook、已有 Host/socket 与手动接入 |

## 能力清单

每个适配器都导出并在运行时注册同一份能力清单。清单分别描述动作、事件、消息段和连接方式，并区分：

- `native`：平台或当前 SDK 原生实现；
- `emulated`：OneBots 做了投影或组合实现，`note` 会说明信息损失；
- `unsupported`：平台没有该能力，不会出现在 `get_supported_actions` 中。

需要额外权限或会话上下文的能力还会声明 `permissions`、`availability` 和适用 `scenes`。调用 `adapter.describeCapabilities(accountId)` 可取得完整清单；调用 `adapter.getSupportedActions(accountId)` 可取得当前可调用动作。OneBots 会校验清单中的动作确有具体实现，防止能力声明与运行时漂移。

能力清单是带版本的闭合运行时契约，不只依赖 TypeScript 类型。适配器注册与实例化都会校验四个分类、支持级别、可用性、场景、权限、消息方向、传输模式以及未知字段，并保存深度不可变的副本。第三方 JavaScript 插件即使绕过编译检查，也不能注册畸形或随后可变的清单；注册失败会进入插件事务回滚，而不会把错误能力发布给管理 API。

管理 API 与 Web 能力面板会实际调用 `describeCapabilities(accountId)`。为避免重复传输，`/api/adapters` 的 `capabilities` 保存适配器默认清单，`accountCapabilities` 只包含与默认对象不同的账号级覆写；Web 选择账号后会明确标记“账号专属清单”或“沿用适配器默认清单”。适配器可据账号 token、套餐或稳定权限信息返回不同清单，但不要把瞬时网络故障伪装成平台能力变化。

显式事件订阅也属于账号能力边界：QQ/Discord 的 intents、Telegram 的 `allowed_updates`、Zulip 的 `event_types` 会投影为当前账号真正可达的 canonical 事件。Webhook、反向 WebSocket、manual 等仅改变接入方式而没有本地事件白名单时，能力清单不会凭空推断上游平台配置。

启动 Web 管理端后，「功能扩展」和「机器人管理 → 能力概览」都会为尚未安装、未加载或未配置账号的平台展示随当前 OneBots 版本发布、绑定适配器包版本的能力目录快照，用户无需创建账号或填写凭据即可在同一概览中比较动作、事件、消息段和连接方式。适配器加载后，概览优先使用插件实际注册的权威清单；创建账号后还可切换到账号视角，查看 token、权限和事件订阅造成的实际覆写。若第三方插件未声明清单，会明确标记为未知，不会用目录快照掩盖运行时缺失。概览会标明「目录快照」或「运行时清单」及对应插件版本；数字只统计原生和模拟能力，明确标记为不支持的项目仍会保留在列表中，权限、场景和上下文限制也会随条目展示。仓库通过 `pnpm catalog:capabilities:check` 校验目录快照与所有适配器构建产物，避免静态副本静默漂移。

能力证据区分 `verified`、`unknown` 和 `unavailable` 三种状态。目录完整性校验失败时，CLI 与 Web 仍保留相关平台，方便用户定位和修复，但不会继续展示或搜索未经验证的快照；空分类也不会被解释为平台不支持。`unknown` 仅表示已加载插件没有声明清单，与目录故障造成的 `unavailable` 分开处理。

无需启动账号也可以从 CLI 导出所选适配器注册的默认清单：

```bash
onebots capabilities -c config.yaml
onebots capabilities -c config.yaml --json
```

命令复用 `plugins.adapters`，也接受 `-r` 按类别覆盖；它只加载适配器入口，不连接平台，也不加载协议。JSON 报告包含包名、版本、真实入口、`status`、四类统计与完整清单，适合选型比较和 CI 留档。插件加载失败会保留在 `errors` 并返回退出码 `2`；适配器未注册默认能力清单或目录证据不可用时 `complete` 为 `false` 并返回退出码 `1`。账号权限、订阅配置产生的覆写只能在服务启动后通过 `/api/adapters` 或 Web 能力面板确认。

### 平台原生动作

标准协议没有覆盖的平台能力统一通过 `adapter.callAction(accountId, action, params)` 调用。每个适配器包同时导出闭合的动作集合、动作联合类型和底层执行器；以 QQ 为例，分别是 `QQ_PLATFORM_ACTIONS`、`QQPlatformAction` 与 `executeQQPlatformAction()`。集合的 `has()` 接受动态字符串并完成类型收窄，因此插件无需复制动作名，也不需要把原生 SDK 客户端擦成通用类型。

具名动作应声明完整的字段白名单、类型、必填关系和 HTTP 位置；官方接口同时使用 query 与 JSON body 时也必须分别建模。只有 `call_*_api` 这类明确命名的底层入口允许携带平台原始对象。这样拼写错误、过期字段和错误类型会在发出网络请求前以结构化错误失败，而不会被静默透传。

```ts
import {
  QQ_PLATFORM_ACTIONS,
  executeQQPlatformAction,
  type QQClient,
} from '@onebots/adapter-qq'

async function callQQ(client: QQClient, action: string, params: Record<string, unknown>) {
  if (!QQ_PLATFORM_ACTIONS.has(action)) throw new Error(`未知 QQ 动作：${action}`)
  return executeQQPlatformAction(client, action, params)
}
```

Web 配置表单只展示启动时通过 `-r` / `-p` 实际加载的适配器和协议；能力选型可以独立使用上述目录快照。插件自己的注册 Schema 是运行时校验、表单分区、敏感字段与动态列表的唯一来源；主程序不维护第二份配置字段清单。

Schema 中的封闭枚举继续使用 `choices`。若数组字段只想提供常用建议、同时允许生态扩展值，应使用 `ui.widget: 'choice-list'` 并显式设置 `allowCustomValues: true`；此时 `choices` 只驱动建议，不会拒绝自定义字符串。该开关只允许用于数组型 `choice-list`，错误组合会在插件注册时失败。

适配器名称、“协议名称 + 版本”以及对应的配置 Schema 键都是进程内唯一标识。同一工厂或同一个 Schema 对象可以重复注册，以兼容插件加载器的幂等调用；不同实现或不同 Schema 不能占用已有标识，注册表会立即抛出 `ValidationError`，避免后加载插件静默改变实现、元数据或配置校验规则。插件卸载实现时，注册表也会一并移除对应 Schema。

插件入口从启动工作目录解析，支持 `exports.import` 条件导出、`module` 与 `main`，随后按纯 ESM 动态导入并等待模块初始化完成，因此可以使用顶层 `await`；初始化 rejection 会原样进入启动与 doctor 诊断，不会被误报为“模块不存在”。

插件必须把 `onebots`（直接使用核心 API 时还包括 `@onebots/core`）声明为 `peerDependencies`，并由启动网关的同一安装根目录提供。加载器会在执行插件代码前比较解析后的真实包路径；若依赖管理器在插件内部安装了第二份副本，或用全局 CLI 加载了绑定项目本地 OneBots 的插件，加载会立即失败，并同时给出插件与网关的解析位置。此时应改用项目本地 `onebots` 启动，或把插件安装到全局 CLI 所在位置。这样工厂不会注册到另一套静态 Registry，也不会再以“模块已初始化但没有注册适配器/协议”的形式掩盖依赖隔离问题。

模块初始化完成后，加载器还会核对插件契约：`-r <name>` 必须注册同名适配器工厂与 Schema，`-p <name>-<version>` 必须注册对应的协议工厂与 `<name>.<version>` Schema。只导出代码、漏执行注册或注册了错误名称的包会立即加载失败，并在 setup、doctor 和服务预检中指出缺少的注册项。

插件导入与上述契约检查构成一次注册事务，并在进程内串行执行。每个事务只能修改 CLI 名称承诺的工厂、元数据与 Schema；额外注册其他适配器或协议，或者用另一个包冒领导入前已经存在的注册身份，都会给出具体冲突项并恢复导入前的全部适配器、协议、Schema 与协议版本元数据。模块初始化抛错或缺少承诺项时也会完整回滚。相同包与入口的重复加载保持幂等；同一协议的多个版本仍可共享协议元数据，并分别注册自己的工厂与 Schema。失败插件不会留下半注册状态，也不会使随后加载的插件产生虚假名称冲突；修复插件后应重新启动进程，让 Node.js 重新导入模块。

### 快速链接

- [QQ 适配器文档](/platform/qq)
- [ICQQ 适配器文档](/platform/icqq)
- [Kook 适配器文档](/platform/kook)
- [黑盒语音适配器文档](/platform/heychat)
- [微信适配器文档](/platform/wechat)
- [微信 ClawBot (iLink) 文档](/platform/wechat-clawbot)
- [Discord 适配器文档](/platform/discord)
- [钉钉适配器文档](/platform/dingtalk)
- [Telegram 适配器文档](/platform/telegram)
- [飞书适配器文档](/platform/feishu)
- [Slack 适配器文档](/platform/slack)
- [企业微信适配器文档](/platform/wecom)
- [微信客服适配器文档](/platform/wecom-kf)
- [Microsoft Teams 适配器文档](/platform/teams)
- [Line 适配器文档](/platform/line)
- [Email 适配器文档](/platform/email)
- [WhatsApp 适配器文档](/platform/whatsapp)
- [Zulip 适配器文档](/platform/zulip)
- [Matrix 适配器文档](/platform/matrix)
- [Google Chat 适配器文档](/platform/google-chat)
- [Facebook Messenger 适配器文档](/platform/facebook-messenger)
- [Instagram Messaging 适配器文档](/platform/instagram)
- [Mattermost 适配器文档](/platform/mattermost)
- [Twitch 适配器文档](/platform/twitch)

## 1. 安装依赖 

根据你要接入的平台安装对应适配器：

```bash
# QQ官方机器人
npm install @onebots/adapter-qq

# Kook
npm install @onebots/adapter-kook

# 微信
npm install @onebots/adapter-wechat

# iLink 微信扩展
npm install @onebots/adapter-wechat-clawbot

# Discord
npm install @onebots/adapter-discord discord.js

# Telegram
npm install @onebots/adapter-telegram grammy

# 飞书
npm install @onebots/adapter-feishu

# 钉钉
npm install @onebots/adapter-dingtalk

# Slack
npm install @onebots/adapter-slack @slack/web-api

# 企业微信
npm install @onebots/adapter-wecom

# Microsoft Teams
npm install @onebots/adapter-teams botbuilder botframework-connector
```

详细说明请参考 [快速开始](./start.md#安装插件)

## 2. 配置说明

onebots 使用 YAML 格式的配置文件，支持为每个账号配置多个协议。

### 配置结构

```yaml
# 全局配置
port: 6727              # HTTP 服务器端口
log_level: info         # 日志级别
timeout: 30             # 登录超时时间(秒)

# 通用配置（协议默认配置）
general:
  onebot.v11:           # OneBot V11 协议通用配置
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  onebot.v12:           # OneBot V12 协议通用配置
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  satori.v1:            # Satori 协议通用配置
    use_http: true
    use_ws: true
    token: ''
  milky.v1:             # Milky 协议通用配置
    use_http: true
    use_ws: true
    access_token: ''

# 账号配置（格式: {platform}.{account_id}）
{platform}.{account_id}:
  # 平台特定配置
  # ...
  
  # 协议配置（覆盖通用配置）
  onebot.v11:
    access_token: 'your_token'
  onebot.v12:
    access_token: 'your_token'
  satori.v1:
    token: 'your_token'
  milky.v1:
    access_token: 'your_token'
```

### 配置示例

::: code-group
```yaml [QQ官方机器人]
port: 6727
log_level: info
timeout: 30

general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000

# QQ 官方机器人账号配置
qq.3889001676:
  # QQ 平台配置
  appid: 'your_app_id'
  secret: 'your_secret'
  mode: 'websocket'
  sandbox: false
  intents:
    - 'GROUP_AND_C2C_EVENT'
    - 'PUBLIC_GUILD_MESSAGES'
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'your_access_token'
```
```yaml [Kook机器人]
port: 6727
log_level: info
timeout: 30

general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  satori.v1:
    use_http: true
    use_ws: true
    token: ''

# Kook 机器人账号配置
kook.zhin:
  # Kook 平台配置
  token: 'your_kook_token'
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'your_v11_token'
  
  # OneBot V12 协议配置
  onebot.v12:
    access_token: 'your_v12_token'
  
  # Satori V1 协议配置
  satori.v1:
    token: 'your_satori_token'
    platform: 'kook'
```
```yaml [微信机器人]
port: 6727
log_level: info
timeout: 30

general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000
  onebot.v12:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000

# 微信机器人账号配置
wechat.bot1:
  # 微信平台配置
  app_id: 'your_app_id'
  app_secret: 'your_app_secret'
  token: 'your_token'
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'your_v11_token'
  
  # OneBot V12 协议配置
  onebot.v12:
    access_token: 'your_v12_token'
```
```yaml [Discord机器人]
port: 6727
log_level: info
timeout: 30

general:
  onebot.v11:
    use_http: true
    use_ws: true
    access_token: ''
    heartbeat_interval: 5000

# Discord 机器人账号配置
discord.bot1:
  # Discord 平台配置
  token: 'your_discord_token'
  
  # OneBot V11 协议配置
  onebot.v11:
    access_token: 'your_access_token'
```
:::

## 3. 配置说明

### 账号配置格式

账号配置的格式为：`{platform}.{account_id}`

- `platform`: 平台名称（如 `qq`、`kook`、`wechat`、`discord`）
- `account_id`: 账号唯一标识（如 QQ 的机器人实例名、Kook 的机器人名称等）

### 协议配置

每个账号可以同时配置多个协议：

- `onebot.v11` - OneBot V11 协议
- `onebot.v12` - OneBot V12 协议
- `satori.v1` - Satori 协议
- `milky.v1` - Milky 协议

### 协议配置项

各协议的通用配置项请参考：
- [OneBot V11 配置](/config/protocol/onebot-v11)
- [OneBot V12 配置](/config/protocol/onebot-v12)
- [Satori 配置](/config/protocol/satori-v1)
- [Milky 配置](/config/protocol/milky-v1)

### 平台特定配置

各平台的特定配置项请参考：
- [QQ 适配器配置](/config/adapter/qq)
- [Kook 适配器配置](/config/adapter/kook)
- [微信适配器配置](/config/adapter/wechat)
- [微信 ClawBot 适配器配置](/config/adapter/wechat-clawbot)
- [Discord 适配器配置](/config/adapter/discord)

## 4. 使用客户端SDK连接

客户端连接地址必须是完整账号协议根，例如 `http://localhost:6727/kook/{account_id}/onebot/v12`。创建 Client、选择接收模式、接入已有 Host 与调用 API 的统一说明见[客户端 SDK 使用指南](/guide/client-sdk)。

## 下一步

- 📚 [配置文件详解](/config/global)
- 💻 [客户端SDK使用指南](/guide/client-sdk)
- 📡 [协议说明](/protocol/onebot-v11)
