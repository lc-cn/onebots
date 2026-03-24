# @onebots/adapter-wechat-ilink

OneBots 适配器：**微信扩展 / iLink Bot HTTP**（平台名 **`wechat-ilink`**）。  
实现扫码登录、`ilink/bot/getupdates` 长轮询、`get_updates_buf` 游标、**`context_token` 写入 OneBots 主库 SQLite**、CDN 媒体收发等。

## 功能一览

| 能力 | 说明 |
|------|------|
| 约定配置 | API/CDN、`bot_type`、自动扫码等由适配器固定，减少 YAML 必填项 |
| 会话文件 | 默认 `{工作目录}/data/wechat-ilink/<account_id>.json`，仅存 token / sync 等；**不含** `contextTokens`（见下表） |
| context_token | 表 **`wechat_ilink_context_token`**（与 `onebots.db` 同库）：主键 `(account_key, peer_id)`，并记录当前 `ilink_bot_id`；读取按 **OneBots `account_id` + 对端 `ilink_user_id`**，与会话里 `accountId` 写入时关联 |
| 会话失效 | 长轮询若收到凭证失效（如 `-14`），会**删除会话 JSON**；**库内 context_token 保留**，自动弹出二维码重登后仍可按 peer 复用 |
| Web 扫码 | 触发 `verification:request`，管理端 SSE 展示二维码（与 icqq 验证流一致） |
| 账号状态 | 长轮询非阻塞启动，正常进入 `ready`，控制台显示在线 |
| `getFriendList` | 返回 1 条占位；`user_id` / `user_name` 使用会话中 **`userId`（微信用户）**，**不用 `accountId`（机器人）** 冒充好友 |
| 主动消息 | 依赖对方先发言或缓存的 `context_token`（与上游一致） |

## 合规说明

微信 / iLink 相关能力受平台协议与法律法规约束。请仅在有权使用的环境中部署，并自行评估合规风险。OneBots 官方 Docker 镜像是否包含本适配器以仓库发布说明为准。

## 安装与注册

```bash
pnpm add @onebots/adapter-wechat-ilink
```

```bash
onebots -r wechat-ilink -c config.yaml
```

## 配置示例

```yaml
wechat-ilink.my_bot: {}
# 可选：仅调优超时
# qr_login_timeout_ms: 480000
# polling_timeout_ms: ...
# polling_retry_delay_ms: ...
```

### 约定（无需在 YAML 填写）

| 项 | 约定 |
|----|------|
| API 根 | `https://ilinkai.weixin.qq.com` |
| CDN 根 | `https://novac2c.cdn.weixin.qq.com/c2c` |
| `bot_type` | `3` |
| 无会话时 | 自动扫码登录（`qr_login` 恒为 `true`） |
| token / ilink_bot_id | 由扫码写入会话文件，**不从配置读取** |

### 会话文件与 context_token

- 会话 JSON 路径：**`{工作目录}/data/wechat-ilink/<account_id>.json`**（文件名中的 `account_id` 会规范为安全字符）
- **`context_token`**：入站更新时写入 **SQLite** 表 `wechat_ilink_context_token`（配置项 `database` 指向的库，默认 `onebots.db`）
- 若曾使用旧版把 `contextTokens` 写在 JSON 里，**首次启动会迁移进库**并写回不含 `contextTokens` 的会话文件
- 单独使用 `IlinkBot`（不经过 OneBots 适配器）时未注入存储，行为仍为内存 + 可选 JSON 中的 `contextTokens`

### 重要限制（与上游一致）

- 主动发消息依赖 **`context_token`**：按对方 `ilink_user_id` 缓存；若对方从未发消息或 token 失效，主动发送可能失败，需等待对方再次发消息。

## 与 `@onebots/core` 的配套

平台名含连字符（`wechat-ilink`）时，`id_map` 表名需在 **`@onebots/core`** 内做安全化；请与包含该修复的 **core** 版本一并升级，否则可能出现 SQLite 建表失败。

## SDK 目录（内部实现）

| 目录 | 职责 |
|------|------|
| `sdk/internal/` | 超时、URL、随机头、Markdown 轻量剥离、凭证合并、错误类型 |
| `sdk/protocol/` | 线级 JSON 模型、归一化事件、入站映射 |
| `sdk/transport/` | `IlinkJsonTransport` 统一 POST/GET 与鉴权头 |
| `sdk/login/` | 扫码登录票据与轮询 |
| `sdk/outbound/` | 出站消息段组装与逐条投递 |
| `sdk/cdn/` | AES-ECB 与 CDN 上传/下载流水线 |
| `sdk/state/` | JSON 文件凭证持久化 |
| `sdk/ilink-bot.ts` | `EventEmitter` 运行时门面 |

## 开发

```bash
pnpm --filter @onebots/adapter-wechat-ilink build
```

仓库内 **`development/verify-wechat-ilink.mjs`** 可做本地冒烟（导入包 + `App.loadAdapterFactory('wechat-ilink')`），需在 `development` 目录执行。
