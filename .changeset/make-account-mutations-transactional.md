---
"@onebots/core": patch
"onebots": patch
---

让账号新增、编辑和删除共享原子运行态与配置文件事务，失败时恢复旧账号、内存配置和磁盘内容，并以 HTTP 409 拒绝并发配置变更。
