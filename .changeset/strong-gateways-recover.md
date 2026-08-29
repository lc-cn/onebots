---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-discord": patch
---

修正 ConnectionManager 首次连接失败后不再重连的问题，并隔离停止或重启前的旧连接结果。

修正 Discord Gateway 的 Resume 握手、远端正常关闭恢复和延迟任务清理，并提供受控的完整 Discord v10 REST API 入口。
