---
"@onebots/core": patch
"onebots": patch
---

让全局 `timeout` 真正约束账号登录监听器与协议出口启动，超时后中止协作式启动信号、保留失败状态，并继续尝试其他账号。
