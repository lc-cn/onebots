---
"onebots": patch
---

根管理 WebSocket 的 `system.saveConfig` 与 `system.reload` 现在复用 HTTP 配置事务、并发锁与验证器，并通过 `system.config.result` 返回可关联的成功或错误回执。可选远端备份失败不再把已生效配置误报为保存失败。
