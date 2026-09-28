---
"@onebots/web": patch
"@onebots/protocol-satori-v1": patch
"@onebots/protocol-milky-v1": patch
---

将“运行与诊断”拆分为接入验证、消息调试和运行日志三个任务页签，并根据已应用配置生成可复制的协议连接地址与下游接入指引。补齐 Satori 与 Milky 传输 schema 的运行时默认值，确保管理端展示的入口与网关实际行为一致。
