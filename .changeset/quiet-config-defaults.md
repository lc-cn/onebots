---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
"@onebots/protocol-onebot-v11": patch
"@onebots/protocol-onebot-v12": patch
"@onebots/protocol-satori-v1": patch
---

修复配置默认值未进入运行实例、可选空字段误报、休眠协议阻止启动和 Web 表单保留数字字符串的问题，统一 OneBot 心跳与请求超时的毫秒语义，并避免 Satori 默认值覆盖来源适配器的平台身份。
