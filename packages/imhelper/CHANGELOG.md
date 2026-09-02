# imhelper

## 1.0.9

### Patch Changes

- 9439cd0: 将协议 Adapter 的实体与消息查询统一为纯 DTO 边界，由 ImHelper 稳定缓存并投影成绑定当前 Client 的行为实例。补齐 OneBot 11/12 好友目录、OneBot 11 消息查询和 Satori 分页目录解析，协议数据结构错误不再伪装为空列表。
- 85784a8: 收紧 npm 发布边界：TypeScript 包不再携带测试产物，Web 管理端只发布构建后的 `dist`。发布流水线会真实打包全部工作区包，拒绝测试、源码、`node_modules` 泄漏或缺失入口的 tarball。
- f7b5c89: 统一客户端 SDK 文档与当前具体 Client、完整协议根、五种接收模式及已有 Host 接入契约；补齐 Milky SDK README 与 canonical 协议说明，并移除未生效的嵌套传输配置类型。
- 71fdd97: 完成全平台适配器能力清单，统一声明原生、模拟、权限、场景、事件、消息段与传输能力，并在运行时校验已声明动作确有具体实现，避免管理端和协议层暴露虚假能力。
- 8d6efe0: 为消息行为保留场景与频道上下文，并为父级依赖目录增加显式 scope。Satori 私聊先创建真实直接消息频道，回复、撤回、编辑与 reaction 原样使用事件 channel_id，同时补齐频道目录、重命名、好友删除、申请处理、Element 编解码与频道消息删除事件。
- 726cc54: 为 SDK 适配器未实现的可选操作提供稳定结构化错误，并停止用空目录伪装不支持的目录能力。
- 16bbe82: 为通用目录查询增加协议无关的 fresh 选项，并让实体 refresh 与 Milky SDK 真正请求服务端刷新数据；同时正确解析 Milky 群与成员列表包装结构，将目录投影和群管理收敛为独立模块。
- 01c56e2: 修正 Telegram 群成员退出服务消息的事件投影，并补齐 OneBot v11、OneBot v12、Satori 与 Milky 对成员变化、消息撤回、好友变化、表态及资源生命周期等通用通知的标准投影。
- 755a836: 让 typed event 在交付前把已确认的用户、群、频道与成员身份写入稳定 identity map。事件实体 getter 不再依赖预先执行目录查询，后续 refresh 仍在同一实例上补全资料，且申请人不会被提前伪装成好友或成员。频道消息与实体新增显式 Guild 上下文，Satori 目录使用准确的 guild scope。OneBot 12 同时补齐频道目录与成员 API、频道双重寻址、可拒绝的好友/群申请动作，保留 opaque flag 与申请子类型，并让扩展邀请动作继续使用协议标准字符串 ID。

## 1.0.8

### Patch Changes

- a87f07a: 闭合 Milky 与 Satori 的原生协议契约，修复各 SDK 在 OneBots 兼容模式下的 WebSocket 地址，并让 Web 配置表单优先使用协议包注册的完整 Schema。
- 844a041: 将事件过滤 AST、编辑器转换与执行器收口为共享模块；由 imhelper 统一管理 SDK 接收传输生命周期，并从 Milky 协议类抽离纯事件投影模块。
- f1493f6: 删除 Web 包中不可达的旧版 imhelper 副本与无效兼容类型；由协议 Schema 声明表单语义分区，并通过统一布局模块生成协议配置界面。
- 78c1e50: 统一 SDK 地址语义并移除隐式 OneBots 路由兼容逻辑；为协议 Schema 增加事件过滤器元数据，在 Web 配置页提供可增删的可视化规则编辑器与高级 JSON 模式。
- 02ab25b: 统一 Receiver 的摄取、鉴权、日志、取消和失败恢复语义，收紧事件工厂与事件监听器类型，补齐文本消息规范化，并规范化事件模块结构与注释。

## 1.0.7

### Patch Changes

- 4d94852: 补齐 OneBot 与 Milky 的 canonical notice、request、meta 事件投影，增加结构化协议错误、手动接收模式，并补充 OneBot V12 响应 echo 类型。

## 1.0.6

### Patch Changes

- 4ab9623: 完善客户端 SDK 的协议类型与宿主集成能力：Milky 使用原生事件和 API，四种协议导出完整 Client 类型并支持可配置 API 地址，WebSocket 默认持续重连，Satori 支持原生通用调用。

## 1.0.5

### Patch Changes

- 41f4bcc: 新增宿主管理的事件入口：`ingest(rawEvent)`、`acceptHttp(request, response?)` 和接收已升级 socket 的 `acceptWebSocket(socket)`，并同步更新 README。

## 1.0.4

### Patch Changes

- b00497a: fix: 调整发布流程,做首次release

## 1.0.3

### Patch Changes

- 5d3787b: fix: v1.0.1

## 1.0.2

### Patch Changes

- 78d4de2: fix: bump version

## 1.0.1

### Patch Changes

- 4f7255b: chore: 切换到 npm OIDC 可信发布
  - 移除 NPM_TOKEN 依赖
  - 使用 GitHub OIDC + Provenance 发布
  - 所有 25 个包已配置 Trusted Publishers

## 1.0.0

### Major Changes

- 57cf3ba: 🎉 OneBots v1.0.0 首次发布

  ## 核心包
  - **@onebots/core** - 核心抽象层，定义适配器、账号、事件等基础接口
  - **onebots** - 主应用包，提供机器人运行时和 HTTP 服务
  - **@onebots/web** - Web 管理界面
  - **imhelper** - 客户端 SDK 核心

  ## 平台适配器 (12+)

  | 适配器                    | 平台            | 描述                           |
  | ------------------------- | --------------- | ------------------------------ |
  | @onebots/adapter-qq       | QQ              | QQ 官方机器人 API              |
  | @onebots/adapter-icqq     | ICQQ            | 基于 @icqqjs/icqq 协议         |
  | @onebots/adapter-kook     | Kook            | Kook (开黑啦) 机器人           |
  | @onebots/adapter-wechat   | 微信            | 微信公众号                     |
  | @onebots/adapter-discord  | Discord         | 轻量级 Discord API 实现        |
  | @onebots/adapter-telegram | Telegram        | 基于 grammy 的 Telegram Bot    |
  | @onebots/adapter-feishu   | 飞书/Lark       | 飞书/Lark 机器人（可配置端点） |
  | @onebots/adapter-dingtalk | 钉钉            | 钉钉机器人                     |
  | @onebots/adapter-slack    | Slack           | Slack 机器人                   |
  | @onebots/adapter-wecom    | 企业微信        | 企业微信机器人                 |
  | @onebots/adapter-teams    | Microsoft Teams | MS Teams 机器人                |
  | @onebots/adapter-line     | Line            | Line Messaging API             |
  | @onebots/adapter-mock     | Mock            | 测试/开发用模拟适配器          |

  ## 协议实现 (服务端)

  | 协议包                       | 协议       | 描述                      |
  | ---------------------------- | ---------- | ------------------------- |
  | @onebots/protocol-satori-v1  | Satori v1  | Satori 协议服务端实现     |
  | @onebots/protocol-onebot-v11 | OneBot v11 | OneBot v11 协议服务端实现 |
  | @onebots/protocol-onebot-v12 | OneBot v12 | OneBot v12 协议服务端实现 |
  | @onebots/protocol-milky-v1   | Milky v1   | Milky 协议服务端实现      |

  ## 客户端 SDK

  | SDK 包               | 协议       | 描述                      |
  | -------------------- | ---------- | ------------------------- |
  | @imhelper/satori-v1  | Satori v1  | Satori 协议客户端 SDK     |
  | @imhelper/onebot-v11 | OneBot v11 | OneBot v11 协议客户端 SDK |
  | @imhelper/onebot-v12 | OneBot v12 | OneBot v12 协议客户端 SDK |
  | @imhelper/milky-v1   | Milky v1   | Milky 协议客户端 SDK      |

  ## 主要特性
  - 🎯 多平台支持 - 统一的 API 接口
  - 🔌 插件系统 - 灵活的中间件架构
  - 📡 多协议支持 - Satori、OneBot v11/v12、Milky
  - 🌐 Web 管理界面 - 可视化管理和监控
  - 🔒 代理支持 - Discord/Telegram 支持 HTTP/HTTPS 代理
  - ☁️ 部分 Serverless 支持 - 飞书、钉钉、QQ 等 Webhook 模式
