---
"onebots": patch
---

修复 Web 扩展中心在 pnpm workspace 中误用 npm 安装扩展、因 `catalog:` 清单字段失败的问题。安装器现在根据运行目录选择 npm 或 pnpm，并在调用 npm 时移除继承自 pnpm 的无效环境配置警告。
