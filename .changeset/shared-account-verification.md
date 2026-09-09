---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
---

通过统一控制客户端提供账号登录验证与回执查询，接通 CLI、TUI 和 Web 控制台。验证码仅用于当前提交，未知结果保留原操作 ID，不自动重发；网关和客户端共用挑战字段规则。
