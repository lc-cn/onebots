---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
---

让 `/ready` 声明当前 OneBots 应用、版本和进程实例身份，并让 Web、doctor、status 与官方容器探针拒绝无法归属到具体 OneBots 实例的就绪响应。
