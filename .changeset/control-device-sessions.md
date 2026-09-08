---
"onebots": patch
"@onebots/core": patch
"@onebots/web": patch
---

管理端支持追加浏览器设备、查看会话及逐设备撤销，CLI/TUI/Web 共用控制接口。新增设备不撤销旧设备，恢复授权撤销全部旧会话，并清理对应 MCP 资源。每个会话保持 30 天绝对有效期，旧有效会话迁移不续期；认证存储升级为多设备格式。
