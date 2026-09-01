---
"onebots": patch
---

收紧官方 Docker 与 Hugging Face 镜像的运行权限：入口完成持久化卷初始化后降权到内置 `node` 用户，并在卷无法安全迁移时拒绝以 root 身份继续运行。
