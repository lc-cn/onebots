---
"@onebots/core": patch
"onebots": patch
---

隔离 Adapter 与 Protocol 实例工厂对全局扩展注册表的副作用，并在越界时恢复原注册状态。
