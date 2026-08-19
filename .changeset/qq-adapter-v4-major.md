---
'@onebots/adapter-qq': patch
---

迁移至 `qq-official-bot@1.3.0`。

**破坏性变更**

- 配置字段 `appId` 重命名为 `appid`（小写 d）
- 删除 `token`/`maxRetry`/`logLevel`（SDK 内部管理 token；retry 与日志级别由 SDK 决定）
- Webhook 模式需显式配置 `port`（与 onebots 主端口区分），不再挂载在 OneBots 主路由上
- Intent 旧名 `GROUP_AT_MESSAGE_CREATE`/`C2C_MESSAGE_CREATE`/`OPEN_FORUMS_EVENT` 已弃用，请改用 SDK 新名 `GROUP_AND_C2C_EVENT`/`FORUMS_EVENT`
- `MIDDLEWARE` 模式本版本不支持
- 内部 `QQBot` 包装类已删除；`account.client` 现在直接是 SDK 的 `Bot` 实例

**新增**

- `apiBaseUrl` 高级 API 根地址覆盖
- `port`/`path` 用于 webhook 模式
- SDK 内部自动管理 token 缓存与刷新