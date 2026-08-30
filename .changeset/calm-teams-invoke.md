---
"@onebots/adapter-teams": patch
---

让 Teams HTTP、manual 与既有 Agents SDK 入口共享可等待、可重试且并发去重的 Activity 投递管线，并为缺失 Activity ID 的事件生成稳定身份。

补齐 Adaptive Card `Action.Execute` 的标准 Invoke 响应，支持可注入处理器、重投响应缓存和公开响应构造器；更新 README 与回归测试。
