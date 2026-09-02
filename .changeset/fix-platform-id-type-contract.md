---
"@onebots/core": patch
"@onebots/adapter-telegram": patch
"@onebots/adapter-wecom": patch
"@onebots/adapter-heychat": patch
---

明确平台 ID 的类型保真契约：原始数字直接作为统一数字 ID，并同时生成字符串形式；只有原始字符串才分配稳定的唯一数字映射。修复 Telegram、企业微信和 HeyChat 提前字符串化数字 ID 的问题。
