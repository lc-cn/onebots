---
"onebots": patch
---

限制 doctor 管理 API 响应为 4 MiB，并在超限时取消读取，防止登录、运行态、能力或扩展证据消耗无界内存。
