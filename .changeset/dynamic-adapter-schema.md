---
"@onebots/core": patch
"@onebots/web": patch
"@onebots/adapter-discord": patch
"@onebots/adapter-telegram": patch
---

为配置 Schema 增加声明式条件显示，Web 表单会动态隐藏并清理非当前模式字段；Discord Intents 与 Telegram Update 订阅改为可增减选项，并统一 Telegram polling/webhook 接收计划及运行时校验。
