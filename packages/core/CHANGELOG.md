# @onebots/core

## 1.2.3

### Patch Changes

- 41f4bcc: 改进 Web 配置、日志与验证管理，补充 MCP 和协议格式测试，并收紧核心、适配器及协议实现的公开类型。四个客户端 SDK 的事件扩展字段和默认响应数据由 `any` 收紧为 `unknown`，调用方需先进行类型收窄。

## 1.2.2

### Patch Changes

- 4fd55a6: 登录验证与配置 Schema 体验修复：
  - 微信 ClawBot 二维码过期自动换码后推送到 Web 并更新 UI；登录成功清理待处理验证
  - ICQQ 将 `login_error` / `offline` 的 message 推送到验证面板，提供「重新登录」等快捷操作；扫码 / 身份验证 / 设备锁统一「已完成，继续登录」
  - `VerificationRequest` 新增 `actions`、`confirmLabel`，网关支持 `verification:clear`
  - 配置 Schema 彻底用 `choices` 替代 `enum`（含中文选项）；object 字段（如 `log_config`）留空不再默认写成 `{}`
  - 拦截 ICQQ SSO 心跳等未处理 Promise rejection，避免拖垮进程；网络闪断依赖自动重连、不误推重登；微信轮询瞬态网络错误降级为 warn

## 1.2.1

### Patch Changes

- 922a341: Use native relative ESM imports in core runtime sources so plain TypeScript builds remain directly loadable without a later alias-rewrite step.
- 15b2540: 适配新版 ICQQ 登录流程：`Adapter.VerificationRequest` 新增 `confirmable` 字段（无需输入、仅需用户确认的验证）。adapter-icqq 补监听 `system.login.auth` 身份验证事件并推送到 Web；扫码确认与身份验证完成后，用户可在 Web 管理端点击「继续登录」按钮，提交后显式调用 `client.login()` 继续登录流程（此前这两步缺少继续通路，登录会卡住）。
- 15b2540: 修复微信 ClawBot（iLink）登录二维码在 Web 管理端无法显示的问题：iLink 的 `qrcode_img_content` 是二维码页面 URL 而非图片，直接 `<img>` 展示会裂图。`Adapter.VerificationBlock` 新增 `qrcode` 内容块类型，适配器改发该类型（并附链接兜底），Web 管理端用 `qrcode` 库在本地渲染二维码图片。

## 1.2.0

### Minor Changes

- 4564d68: refactor: Phase 3-5 架构优化补完

  Phase 3: 大文件拆分
  - refactor(core): adapter.ts 1562→382 行, ID 管理提取到 adapter-id-manager.ts
  - refactor(onebots): app.ts 1209→~400 行, 7 个路由模块 (auth/adapter-api/config/terminal/verification/public-static)

  Phase 4: 测试覆盖提升
  - test(core): proxy/id-manager/retry 单元测试 (21 用例)
  - test(adapter-mock): 完整生命周期集成测试 (86 用例)
  - test(protocol): CQ 码解析 + 格式转换测试 (40+ 用例)

  Phase 5: 工程规范
  - ci: ESLint flat config, no-explicit-any/no-console 门禁
  - refactor: 18 适配器 barrel export 清理
  - chore: 硬编码超时提取为命名常量
  - docs: CONTRIBUTING.md 中文贡献指南

## 1.1.0

### Minor Changes

- d9fdbd5: refactor: Phase 0+1 架构优化

  Phase 0: 安全与稳定基线
  - fix(service-manager): execSync → execFileSync, getHomeDir() 安全兜底
  - fix(app.ts): 空 catch 块加注释或日志输出
  - chore(vitest): 测试范围扩展到 adapters/ 和 protocols/

  Phase 1: 统一基础设施
  - feat(core): 新增 proxy.ts 统一代理 Agent 工厂（createProxyAgent, buildProxyUrl, maskProxyUrl）
  - feat(core): 改进 ConnectionManager（logger 注入, onConnected/onMaxRetriesReached 回调）
  - refactor: 6 个适配器迁移到共享代理工具, 3 个适配器迁移到 ConnectionManager
  - fix(onebots/index.ts): 消除 export \* from '@onebots/core'，改为显式导出

## 1.0.6

### Patch Changes

- b00497a: fix: 调整发布流程,做首次release

## 1.0.5

### Patch Changes

- ee4e625: ## 新增 `@onebots/adapter-wechat-ilink`

  微信扩展 / **iLink Bot HTTP** 适配器（平台名 `wechat-ilink`），自实现扫码、`getupdates` 长轮询、CDN 媒体收发与 JSON API。

  ### 功能摘要
  - **约定大于配置**：API/CDN 根地址、`bot_type=3`、无会话时自动扫码等由适配器固定，YAML 仅需账号段 + 可选超时（`qr_login_timeout_ms` / `polling_*`）。
  - **会话持久化**：登录态 JSON（`data/wechat-ilink/<account_id>.json`）仅存 token/sync 等；**`context_token` 写入主库 SQLite 表 `wechat_ilink_context_token`**（按 OneBots `account_id` + 对端 peer，写入时带会话 `ilink_bot_id`）；旧 JSON 内 `contextTokens` 首次启动自动迁库。
  - **Web 管理端**：扫码登录时 `emit('verification:request')`，与 icqq 一致推送到控制台「登录验证」SSE；HTTPS 二维码 URL 使用 `image_url` 块**直接内嵌展示**，无需再点链接打开。
  - **账号状态**：长轮询改为后台运行，启动完成后正确 `ready`，Web 端显示在线。
  - **API**：`getFriendList` 返回单条好友信息，字段来自会话 `CredentialBlob.userId`（微信用户），`accountId` 为机器人不在好友条目中误用。

  ### 依赖与配套
  - **`@onebots/core`（patch）**：`Adapter` 的 `id_map` 表名对平台名做安全化；`VerificationBlock` 增加 `image_url`；`SqliteDB` 增加 `execSQL` 供复合主键建表等 DDL。
  - **`@onebots/web`（patch）**：验证面板支持渲染 `image_url` 块（`referrerpolicy="no-referrer"`，兼容微信 CDN）。

  ***

  ## English summary
  - **New package** `@onebots/adapter-wechat-ilink`: WeChat extension via iLink Bot HTTP (`wechat-ilink`), with QR login, long polling, CDN media, and JSON APIs.
  - **Convention-first config**; session file under `data/wechat-ilink/<account_id>.json` by default.
  - **Web verification** push for QR login; **online status** after polling starts; **`getFriendList`** uses session `userId` for the single stub friend row.
  - **`@onebots/core`**: sanitize `id_map_*`; `VerificationBlock` `image_url`; `SqliteDB.execSQL`.
  - **`@onebots/web`**: render `image_url` in verification drawer.

## 1.0.4

### Patch Changes

- 2645ccf: 新增全局配置 `public_static_dir`：托管站点根静态文件（如企业微信可信域名校验 txt）；Docker / HF 入口脚本创建 `/data/static` 便于与配置一并持久化；Web 管理端「配置 → 站点静态」支持列表、上传与删除；`koa-body` 启用 multipart（单文件 ≤2MB）。在 Hugging Face Space 等已配置 `HF_TOKEN`、`HF_REPO_ID` 时，上传/删除站点静态文件后会自动调用 HF commit 接口，重新打包提交 `config_backup.yaml` 与 `data_backup.tar.gz`（含 static）。

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

## 0.5.0

### Minor Changes

- f3372b5: fix: refactory

### Patch Changes

- f3372b5: fix: 初始化管理
