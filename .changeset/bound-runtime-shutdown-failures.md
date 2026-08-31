---
"onebots": patch
---

让 SIGINT 与 SIGTERM 的优雅停机在清理失败时继续保留 30 秒强制退出兜底，避免残留网络或 SDK 句柄让进程永久挂起。
