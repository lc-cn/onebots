---
"@onebots/adapter-kook": patch
"@onebots/adapter-line": patch
"@onebots/adapter-teams": patch
"@onebots/adapter-wecom": patch
"@onebots/adapter-wecom-kf": patch
"@onebots/adapter-whatsapp": patch
"@onebots/adapter-wechat": patch
---

让七个适配器复用 core 的包版本读取模块，删除各自重复的文件读取、JSON 解析与错误处理实现。
