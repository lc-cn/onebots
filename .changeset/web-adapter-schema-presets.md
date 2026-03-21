---
"onebots": patch
"@onebots/web": patch
---

Web 管理端 `/api/config/schema` 合并适配器配置预设：在未使用 `-r` 加载 `wecom-kf`、`icqq` 等包时仍可提供表单项；并补充 line、email、whatsapp、zulip、mock 的预设。账号管理页平台字段改为可搜索下拉并支持手动输入。

Docker / HF 官方镜像默认增加 `-r wecom-kf`；**不包含 ICQQ**（`.dockerignore` 排除 `adapters/adapter-icqq`，构建无需 GH Packages token）。ICQQ 仅本地/自建镜像使用，见文档。
