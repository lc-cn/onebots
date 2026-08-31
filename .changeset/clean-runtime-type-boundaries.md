---
"@onebots/core": patch
"onebots": patch
"@onebots/web": patch
"@onebots/protocol-onebot-v11": patch
---

收紧 CLI 的可选 MCP stdio 模块、鉴权路由和 OneBot v11 自定义音乐段类型边界，集中 CLI 输出与 Web 客户端诊断出口；setup 仅从实际加载的协议生成默认配置，并清理会掩盖真实类型问题的宽泛断言和无效变量。
