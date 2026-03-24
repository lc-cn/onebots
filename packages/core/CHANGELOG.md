# @onebots/core

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
