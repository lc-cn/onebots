---
"@onebots/core": patch
"onebots": patch
---

持久化 setup 验证过的适配器与协议选择，并让前台启动、doctor、服务安装、更新和 MCP 模式在未显式传参时复用配置默认值。插件选择发生变化时现在会明确要求重启，避免运行态与磁盘配置不一致。
