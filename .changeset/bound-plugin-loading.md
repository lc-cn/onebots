---
"@onebots/core": patch
"onebots": patch
---

为插件异步注册事务增加超时、回滚和迟到修改隔离，避免异常入口永久阻塞启动与诊断。
