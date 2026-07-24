---
"onebots": patch
---

修复 pnpm 全局安装后 CLI 因 `@inkjs/ui` 未声明 `react` 依赖而报 `Cannot find package 'react'`（`onebots -h` 等命令无法启动）。
