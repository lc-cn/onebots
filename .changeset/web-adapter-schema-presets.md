---
"onebots": patch
"@onebots/web": patch
---

Web 管理端 `/api/config/schema` 合并适配器配置预设：在未使用 `-r` 加载 `wecom-kf`、`icqq` 等包时仍可提供表单项；并补充 line、email、whatsapp、zulip、mock 的预设。账号管理页平台字段改为可搜索下拉并支持手动输入。

Docker / HF 镜像与 `development` 的 `pnpm dev` 默认增加 `-r wecom-kf`、`-r icqq`（镜像需在构建阶段用 `NODE_AUTH_TOKEN` 装好 `@icqqjs/icqq`，启动后无需 token）。`development` 增加对 `@onebots/adapter-icqq` 的 workspace 依赖以便解析。
