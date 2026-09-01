---
"onebots": patch
---

在扩展安装与更新前把 `catalog:` 依赖识别为 pnpm 证据，并提前拒绝它与 npm 锁文件的冲突，避免 npm 执行后才以 `EUNSUPPORTEDPROTOCOL` 失败。
