---
"@onebots/core": patch
---

统一 Router 的 WebSocket 路径与关闭语义，停止时先拒绝新升级并终止活跃连接，避免清理永久等待。
