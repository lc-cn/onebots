---
"@onebots/adapter-icqq": patch
"@onebots/protocol-milky-v1": patch
"onebots": patch
---

统一 ICQQ 标准动作与原生扩展动作的账号、连接、参数、资源和操作失败错误，并移除动作模块中的重复账号查找、裸错误与验证入口静默成功；同时公开核心错误分类，并让 Milky 按分类稳定投影参数与资源错误。
