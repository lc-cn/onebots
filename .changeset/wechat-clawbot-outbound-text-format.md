---
"@onebots/adapter-wechat-clawbot": patch
---

新增 `outbound_text_format` 配置，可选择兼容纯文本或 Markdown 原样透传；修复纯文本转换吞掉段落换行的问题，并让媒体 caption 遵循相同格式策略。
