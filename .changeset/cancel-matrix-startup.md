---
"@onebots/adapter-matrix": patch
---

将账号启动取消信号传播到 Matrix `whoami` 与 `/sync` 请求，并结合连接代次阻止超时后的迟到响应恢复账号状态。
