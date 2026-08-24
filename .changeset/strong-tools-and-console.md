---
'onebots': minor
'@onebots/web': minor
'@onebots/core': patch
'@onebots/adapter-discord': patch
'@onebots/adapter-email': patch
'@onebots/adapter-line': patch
'@onebots/adapter-telegram': patch
'@onebots/adapter-whatsapp': patch
'@onebots/adapter-zulip': patch
'@onebots/protocol-mcp-v1': patch
'@onebots/mcp-client': patch
'@onebots/protocol-milky-v1': patch
'@onebots/protocol-onebot-v11': patch
'@onebots/protocol-onebot-v12': patch
'@onebots/protocol-satori-v1': patch
'@imhelper/milky-v1': major
'@imhelper/onebot-v11': major
'@imhelper/onebot-v12': major
'@imhelper/satori-v1': major
---

改进 Web 配置、日志与验证管理，补充 MCP 和协议格式测试，并收紧核心、适配器及协议实现的公开类型。四个客户端 SDK 的事件扩展字段和默认响应数据由 `any` 收紧为 `unknown`，调用方需先进行类型收窄。
