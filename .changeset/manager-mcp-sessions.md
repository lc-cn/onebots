---
"@onebots/core": patch
"onebots": patch
"@onebots/protocol-mcp-v1": patch
---

将 MCP stdio 命令迁移到管理服务：通过私有控制连接使用当前网关的已配置账号，以设备会话和网关实例隔离连接；网关停止或重启后关闭旧会话，不重放工具调用。删除命令自行启动账号的旧实现，兼容标准初始化通知并补齐有界事件推送。
