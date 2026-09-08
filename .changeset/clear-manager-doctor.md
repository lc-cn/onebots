---
"onebots": patch
"@onebots/core": patch
---

将 doctor 入口迁移到常驻管理服务的只读诊断，支持通过 --data-dir 诊断前台和 Docker 工作区；不再通过旧 --fix 旁路改写配置、权限或服务。诊断报告明确列出尚未验证的项目，不以管理端可达代替完整验收。
