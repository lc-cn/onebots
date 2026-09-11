---
"onebots": patch
---

修复 Windows 构建运行工件时无法直接执行 pnpm 命令包装器的问题，改为使用仓库锁定的 pnpm 入口完成安全打包。
