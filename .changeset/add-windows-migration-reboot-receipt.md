---
"onebots": patch
---

为 `onebots migrate --system` 增加 Windows 两阶段迁移：持久化受保护的重启收据，以显式 `--restart` 完成完整重启，重启后核验旧服务停机再安装管理服务；`recover --rollback-migration` 可在最终提交前恢复旧 SCM 启动类型与运行意图。
