---
"@onebots/core": patch
"onebots": patch
"@onebots/adapter-mock": patch
"@onebots/adapter-kook": patch
"@onebots/adapter-qq": patch
"@onebots/adapter-teams": patch
"@onebots/adapter-wecom": patch
"@onebots/adapter-wecom-kf": patch
"@onebots/protocol-mcp-v1": patch
---

建立统一的 Adapter 能力清单与结构化能力错误，修复 Teams、Mock 和企业微信事件投递，并复用微信生态回调验签、解密与 XML 解析实现。
