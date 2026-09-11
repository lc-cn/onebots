---
"@onebots/core": patch
"onebots": patch
---

统一宿主并发启停任务，并在停止时取消生命周期、HTTP 监听和适配器启动队列，避免迟到的启动结果重新打开端口或继续启动账号。
