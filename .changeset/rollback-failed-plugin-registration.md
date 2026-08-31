---
"@onebots/core": patch
"onebots": patch
---

插件加载现在以串行注册事务执行。初始化抛错或未满足工厂与 Schema 契约时，会恢复导入前的适配器、协议、Schema 和协议版本元数据，避免失败插件污染后续启动、doctor 与服务预检。
