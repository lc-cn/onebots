---
"onebots": patch
---

新增迁移早期失败的显式取消入口：`onebots recover --operation <id> --cancel-migration`。仅在尚未停服且旧服务基线未变时结束原操作，保留配置、备份和运行工件，不重放系统动作。修复 pnpm 注入 NODE_PATH 导致旧依赖发现混入管理工具依赖的问题。
